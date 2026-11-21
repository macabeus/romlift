// `npm run fixtures -- rebuild|check [--only <name>] [--json]` (architecture §8.1, D28): builds the
// self-authored synthetic fixtures under bench/dataset/synthetic/<name>/ with agbcc and binutils.
//
//   rebuild  builds every fixture into a temporary directory, copies build/<name>.gba and
//            build/<name>.elf into the fixture (and build/<name>.map for a build.mk with `MAP := yes`, its
//            temporary paths spelt build/), and writes the toolchain record into its build.mk.
//   check    builds every fixture into a temporary directory and compares it with the committed
//            build: the .gba bytes, the sorted (name, value, size, type) list of the ELF symbol table,
//            the input placements of the map where build.mk asks for one (output section, input section,
//            address, size and object; ld's layout of the text is not compared, so another binutils agrees)
//            and build.mk's toolchain record. An agbcc commit that differs from the record fails; an
//            `as --version` line that differs is a note. Exit 0 only when every fixture agrees.
//
// The toolchain: the checkout's agbcc (tools/agbcc, the submodule at templates/agbcc.json's commit, built in place
// when it is not yet built at that pin; bench/src/agbcc.ts, D120) and old_agbcc beside it (bin/old_agbcc), which make
// gets as OLD_AGBCC for the sources a build.mk lists in OLD_AGBCC_SRCS; a fixture that lists one fails when
// bin/old_agbcc is missing. Binutils from the PATH. The agbcc commit is the pin's, which the submodule is checked out
// at. --json prints a final summary line.
//
// The comparison logic is pure and exported for test/unit/fixtures; main() is the only I/O.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ElfFile, type ElfSymbolType, compareCodeUnits, parseElf, parseGnuMap } from 'romlift';
import { type Binutils, binutilsVersions, findBinutils } from 'romlift/node';

import { checkoutAgbcc, templatePin } from '../src/agbcc.ts';
import { UsageError, parseArgs } from '../src/args.ts';
import { contextFromEnv } from '../src/context.ts';
import { BenchError, exists, readFileBytes, readText, writeText } from '../src/files.ts';
import { runProcess } from '../src/process.ts';

export const FIXTURES_SCHEMA = 'romlift/fixtures@1';
const USAGE = 'usage: npm run fixtures -- rebuild|check [--only <name>] [--json]';

/** What build.mk records about the toolchain that built the committed files (D28). */
export interface ToolchainRecord {
  /** The pret/agbcc commit, full or abbreviated hex. */
  readonly agbccCommit: string;
  /** The first line of `arm-none-eabi-as --version`. */
  readonly asVersion: string;
}

/** The toolchain of this run. */
export interface ToolchainInUse {
  readonly agbcc: string;
  /** bin/old_agbcc beside agbcc, or undefined when that file does not exist. */
  readonly oldAgbcc: string | undefined;
  readonly agbccCommit: string;
  readonly binutils: Binutils;
  readonly asVersion: string;
}

/** One entry of the compared symbol list. */
export interface SymbolRow {
  readonly name: string;
  readonly value: number;
  readonly size: number;
  readonly type: ElfSymbolType;
}

/** A fixture's build: the cartridge bytes, the compared symbol list of its ELF and, when it has one, its map's placements. */
export interface FixtureBuild {
  readonly gba: Uint8Array;
  readonly symbols: readonly SymbolRow[];
  readonly map?: readonly string[];
}

export interface FixtureVerdict {
  readonly name: string;
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

const RECORD_KEYS = { agbccCommit: 'AGBCC_COMMIT', asVersion: 'AS_VERSION' } as const;
const RECORD_HEADER = '# Toolchain record (D28), written by `npm run fixtures -- rebuild`:';

function recordLine(text: string, key: string): string | undefined {
  const prefix = `${key} := `;
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

/** The toolchain record of a build.mk, or the keys it lacks. */
export function parseToolchainRecord(buildMk: string): ToolchainRecord | { readonly missing: readonly string[] } {
  const agbccCommit = recordLine(buildMk, RECORD_KEYS.agbccCommit);
  const asVersion = recordLine(buildMk, RECORD_KEYS.asVersion);
  if (agbccCommit === undefined || agbccCommit === '' || asVersion === undefined || asVersion === '') {
    const missing: string[] = [];
    if (agbccCommit === undefined || agbccCommit === '') missing.push(RECORD_KEYS.agbccCommit);
    if (asVersion === undefined || asVersion === '') missing.push(RECORD_KEYS.asVersion);
    return { missing };
  }
  return { agbccCommit, asVersion };
}

/** build.mk with its toolchain record set to `record`: the record lines replaced, or inserted before `include`. */
export function withToolchainRecord(buildMk: string, record: ToolchainRecord): string {
  const lines = buildMk
    .split('\n')
    .filter(
      (l) =>
        l !== RECORD_HEADER &&
        !l.startsWith(`${RECORD_KEYS.agbccCommit} := `) &&
        !l.startsWith(`${RECORD_KEYS.asVersion} := `),
    );
  const block = [
    RECORD_HEADER,
    `${RECORD_KEYS.agbccCommit} := ${record.agbccCommit}`,
    `${RECORD_KEYS.asVersion} := ${record.asVersion}`,
  ];
  const at = lines.findIndex((l) => l.startsWith('include '));
  const index = at === -1 ? lines.length : at;
  return [...lines.slice(0, index), ...block, ...lines.slice(index)].join('\n');
}

const OLD_AGBCC_SRCS_KEY = 'OLD_AGBCC_SRCS';

const MAP_KEY = 'MAP';

/** Whether a build.mk asks for the GNU map (`MAP := yes`, the signature fixtures). */
export function wantsMap(buildMk: string): boolean {
  return recordLine(buildMk, MAP_KEY) === 'yes';
}

/** A map ld wrote under the temporary build directory `out`, with every `<out>/` spelt `build/` (what is committed). */
export function committedMapText(text: string, out: string): string {
  return text.split(`${out}/`).join('build/');
}

/** The compared rows of a map: one per input placement, `<output> <input> <address> <size> <object>`, in map order. */
export function mapRows(text: string): readonly string[] {
  const map = parseGnuMap(text);
  if (!map.ok) return [`unparsable map: ${map.error}`];
  return map.value.sections.flatMap((section) =>
    section.inputs.map(
      (i) =>
        `${section.name} ${i.section} ${hex(i.address)} ${hex(i.size)} ${i.member === undefined ? i.file : `${i.file}(${i.member})`}`,
    ),
  );
}

/** The differences of two maps' rows, at most `limit` of them. */
export function mapDifferences(committed: readonly string[], rebuilt: readonly string[], limit = 8): readonly string[] {
  const left = new Set(committed);
  const right = new Set(rebuilt);
  const out = [
    ...committed.filter((r) => !right.has(r)).map((r) => `map placement only in the committed map: ${r}`),
    ...rebuilt.filter((r) => !left.has(r)).map((r) => `map placement only in the rebuilt map: ${r}`),
  ];
  return out.length > limit ? [...out.slice(0, limit), `${out.length - limit} more map differences`] : out;
}

/** The sources a build.mk compiles with old_agbcc (its `OLD_AGBCC_SRCS := …` line), in the order it lists them. */
export function oldAgbccSources(buildMk: string): readonly string[] {
  return (recordLine(buildMk, OLD_AGBCC_SRCS_KEY) ?? '').split(/\s+/).filter((s) => s !== '');
}

/** old_agbcc beside an agbcc executable: the same directory, `old_agbcc` (pret/agbcc's install.sh puts both in bin/). */
export function oldAgbccBeside(agbcc: string): string {
  return join(dirname(agbcc), 'old_agbcc');
}

/** The make arguments of one fixture build into `out` (OLD_AGBCC only when the toolchain has it). */
export function makeArgs(
  out: string,
  toolchain: Pick<ToolchainInUse, 'agbcc' | 'oldAgbcc' | 'binutils'>,
): readonly string[] {
  return [
    '-f',
    'build.mk',
    '--no-print-directory',
    `BUILD=${out}`,
    `AGBCC=${toolchain.agbcc}`,
    ...(toolchain.oldAgbcc === undefined ? [] : [`OLD_AGBCC=${toolchain.oldAgbcc}`]),
    `ARM_AS=${toolchain.binutils.as}`,
    `ARM_LD=${toolchain.binutils.ld}`,
    `ARM_OBJCOPY=${toolchain.binutils.objcopy}`,
  ];
}

/** Whether two commit spellings name the same commit: equal, or one a prefix (at least 7 digits) of the other. */
export function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 7 && /^[0-9a-f]+$/.test(short) && long.startsWith(short);
}

/**
 * The compared symbol list: every defined symbol of the ELF as (name, raw value, size, type), sorted
 * by name, value, size and type, so neither the symbol-table order nor any other ELF metadata, which
 * legitimately differs between binutils builds, takes part (D28).
 */
export function symbolRows(elf: ElfFile): readonly SymbolRow[] {
  return elf.symbols
    .map((s) => ({ name: s.name, value: s.value, size: s.size, type: s.type }))
    .sort(
      (a, b) =>
        compareCodeUnits(a.name, b.name) || a.value - b.value || a.size - b.size || compareCodeUnits(a.type, b.type),
    );
}

function hex(n: number): string {
  return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
}

function rowText(r: SymbolRow): string {
  return `${r.name} ${hex(r.value)} ${r.size} ${r.type}`;
}

/** The first difference of two byte strings, or undefined when they are equal. */
export function bytesDifference(committed: Uint8Array, rebuilt: Uint8Array): string | undefined {
  const n = Math.min(committed.length, rebuilt.length);
  for (let i = 0; i < n; i++) {
    if (committed[i] !== rebuilt[i])
      return `the .gba differs first at offset ${hex(i)} (committed 0x${(committed[i] ?? 0).toString(16)}, rebuilt 0x${(rebuilt[i] ?? 0).toString(16)})`;
  }
  return committed.length === rebuilt.length
    ? undefined
    : `the .gba is ${committed.length} bytes committed and ${rebuilt.length} rebuilt`;
}

/** The differences of two symbol lists, at most `limit` of them. */
export function symbolDifferences(
  committed: readonly SymbolRow[],
  rebuilt: readonly SymbolRow[],
  limit = 8,
): readonly string[] {
  const left = new Set(committed.map(rowText));
  const right = new Set(rebuilt.map(rowText));
  const out = [
    ...[...left].filter((r) => !right.has(r)).map((r) => `symbol only in the committed ELF: ${r}`),
    ...[...right].filter((r) => !left.has(r)).map((r) => `symbol only in the rebuilt ELF: ${r}`),
  ];
  return out.length > limit ? [...out.slice(0, limit), `${out.length - limit} more symbol differences`] : out;
}

/** The verdict of one fixture: its committed build and record against a rebuild with `toolchain`. */
export function compareFixture(
  name: string,
  committed: FixtureBuild,
  record: ToolchainRecord | { readonly missing: readonly string[] },
  rebuilt: FixtureBuild,
  toolchain: Pick<ToolchainInUse, 'agbccCommit' | 'asVersion'>,
): FixtureVerdict {
  const problems: string[] = [];
  const notes: string[] = [];
  const bytes = bytesDifference(committed.gba, rebuilt.gba);
  if (bytes !== undefined) problems.push(bytes);
  problems.push(...symbolDifferences(committed.symbols, rebuilt.symbols));
  if (committed.map !== undefined || rebuilt.map !== undefined)
    problems.push(...mapDifferences(committed.map ?? [], rebuilt.map ?? []));
  if ('missing' in record) {
    problems.push(`build.mk has no toolchain record (${record.missing.join(', ')})`);
  } else {
    if (!sameCommit(record.agbccCommit, toolchain.agbccCommit)) {
      problems.push(`agbcc commit ${toolchain.agbccCommit} differs from the recorded ${record.agbccCommit}`);
    }
    if (record.asVersion !== toolchain.asVersion)
      notes.push(`as is '${toolchain.asVersion}', the record names '${record.asVersion}'`);
  }
  return { name, ok: problems.length === 0, problems, notes };
}

/** The final --json line. */
export function summaryLine(
  command: 'rebuild' | 'check',
  verdicts: readonly FixtureVerdict[],
  toolchain: Pick<ToolchainInUse, 'agbccCommit' | 'asVersion'>,
): string {
  const failed = verdicts.filter((v) => !v.ok).map((v) => v.name);
  return JSON.stringify({
    schema: FIXTURES_SCHEMA,
    command,
    ok: failed.length === 0,
    fixtures: verdicts.length,
    failed,
    toolchain: { agbccCommit: toolchain.agbccCommit, as: toolchain.asVersion },
    verdicts,
  });
}

// ---------------------------------------------------------------- I/O

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(file: string, args: readonly string[], cwd?: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(file, [...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 127;
      resolve({ code, stdout, stderr: error !== null && stderr === '' ? error.message : stderr });
    });
  });
}

export const SYNTHETIC_DIR = fileURLToPath(new URL('../dataset/synthetic/', import.meta.url));

/** The fixture directories under `root` (those holding a build.mk), sorted by name. */
async function fixtureNames(root: string): Promise<readonly string[]> {
  const names: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(join(root, entry.name, 'build.mk')))) names.push(entry.name);
  }
  return names.sort(compareCodeUnits);
}

async function toolchainFromEnv(env: Readonly<Record<string, string | undefined>>): Promise<ToolchainInUse> {
  const cx = contextFromEnv(env);
  const dir = await checkoutAgbcc(cx, { run: runProcess, log: (line) => process.stderr.write(`${line}\n`) });
  const agbcc = join(dir, 'bin', 'agbcc');
  const oldAgbcc = oldAgbccBeside(agbcc);
  const binutils = findBinutils(env);
  if ('code' in binutils) throw new BenchError(binutils.message);
  const versions = await binutilsVersions(binutils);
  if (versions.as === '') throw new BenchError(`${binutils.as} --version printed nothing`);
  return {
    agbcc,
    oldAgbcc: (await exists(oldAgbcc)) ? oldAgbcc : undefined,
    agbccCommit: (await templatePin(cx)).commit,
    binutils,
    asVersion: versions.as,
  };
}

function buildOf(gba: Uint8Array, elfBytes: Uint8Array, mapText: string | undefined, what: string): FixtureBuild {
  const elf = parseElf(elfBytes);
  if (!elf.ok) throw new BenchError(`${what}: ${elf.error}`);
  return mapText === undefined
    ? { gba, symbols: symbolRows(elf.value) }
    : { gba, symbols: symbolRows(elf.value), map: mapRows(mapText) };
}

/** A build in `dir`; with `mapFrom`, its map too, read with the temporary paths of `mapFrom.out` spelt as committed. */
async function readBuild(
  dir: string,
  name: string,
  what: string,
  mapFrom?: { readonly out: string },
): Promise<FixtureBuild> {
  const mapText =
    mapFrom === undefined ? undefined : committedMapText(await readText(join(dir, `${name}.map`)), mapFrom.out);
  return buildOf(
    await readFileBytes(join(dir, `${name}.gba`)),
    await readFileBytes(join(dir, `${name}.elf`)),
    mapText,
    what,
  );
}

/** Builds fixture `name` into `out` with make; throws with make's output when it fails, or when it needs a missing old_agbcc. */
async function make(name: string, out: string, toolchain: ToolchainInUse): Promise<void> {
  const dir = join(SYNTHETIC_DIR, name);
  const old = oldAgbccSources(await readText(join(dir, 'build.mk')));
  if (old.length > 0 && toolchain.oldAgbcc === undefined) {
    throw new BenchError(
      `${name}: compiles ${old.join(', ')} with old_agbcc, and there is no ${oldAgbccBeside(toolchain.agbcc)}`,
    );
  }
  const made = await run('make', makeArgs(out, toolchain), dir);
  if (made.code !== 0) throw new BenchError(`${name}: make exited ${made.code}:\n${made.stdout}${made.stderr}`);
}

async function withTemp<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-fixture-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rebuildOne(name: string, toolchain: ToolchainInUse): Promise<FixtureVerdict> {
  const record: ToolchainRecord = { agbccCommit: toolchain.agbccCommit, asVersion: toolchain.asVersion };
  const dir = join(SYNTHETIC_DIR, name);
  const withMap = wantsMap(await readText(join(dir, 'build.mk')));
  await withTemp(async (out) => {
    await make(name, out, toolchain);
    await mkdir(join(dir, 'build'), { recursive: true });
    for (const ext of ['gba', 'elf']) await copyFile(join(out, `${name}.${ext}`), join(dir, 'build', `${name}.${ext}`));
    if (withMap)
      await writeText(
        join(dir, 'build', `${name}.map`),
        committedMapText(await readText(join(out, `${name}.map`)), out),
      );
  });
  const buildMk = join(dir, 'build.mk');
  await writeText(buildMk, withToolchainRecord(await readText(buildMk), record));
  return { name, ok: true, problems: [], notes: [] };
}

async function checkOne(name: string, toolchain: ToolchainInUse): Promise<FixtureVerdict> {
  const dir = join(SYNTHETIC_DIR, name);
  const committedDir = join(dir, 'build');
  const buildMk = await readText(join(dir, 'build.mk'));
  const withMap = wantsMap(buildMk);
  const missing = [];
  for (const ext of withMap ? ['gba', 'elf', 'map'] : ['gba', 'elf'])
    if (!(await exists(join(committedDir, `${name}.${ext}`)))) missing.push(`build/${name}.${ext}`);
  if (missing.length > 0) return { name, ok: false, problems: [`not committed: ${missing.join(', ')}`], notes: [] };
  const committed = await readBuild(
    committedDir,
    name,
    `${name} (committed)`,
    withMap ? { out: committedDir } : undefined,
  );
  const record = parseToolchainRecord(buildMk);
  return withTemp(async (out) => {
    try {
      await make(name, out, toolchain);
    } catch (error) {
      return { name, ok: false, problems: [error instanceof Error ? error.message : String(error)], notes: [] };
    }
    return compareFixture(
      name,
      committed,
      record,
      await readBuild(out, name, `${name} (rebuilt)`, withMap ? { out } : undefined),
      toolchain,
    );
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'rebuild' && command !== 'check') throw new UsageError(USAGE);
  const args = parseArgs(rest, { options: ['only'], flags: ['json'] });
  if (!(await exists(SYNTHETIC_DIR))) throw new BenchError(`no directory ${SYNTHETIC_DIR}`);
  const all = await fixtureNames(SYNTHETIC_DIR);
  const only = args.options['only'];
  const names = only === undefined ? all : all.filter((n) => n === only);
  if (names.length === 0)
    throw new BenchError(only === undefined ? `no fixture under ${SYNTHETIC_DIR}` : `no fixture named ${only}`);
  const toolchain = await toolchainFromEnv(process.env);
  const verdicts: FixtureVerdict[] = [];
  for (const name of names) {
    const verdict = command === 'rebuild' ? await rebuildOne(name, toolchain) : await checkOne(name, toolchain);
    verdicts.push(verdict);
    process.stdout.write(`${verdict.ok ? 'ok  ' : 'FAIL'} ${name}\n`);
    for (const p of verdict.problems) process.stdout.write(`       ${p}\n`);
    for (const n of verdict.notes) process.stdout.write(`       note: ${n}\n`);
  }
  const failed = verdicts.filter((v) => !v.ok).length;
  process.stdout.write(
    `${command}: ${verdicts.length - failed} of ${verdicts.length} fixtures agree (agbcc ${toolchain.agbccCommit}, ${toolchain.asVersion})\n`,
  );
  if (args.flags.has('json')) process.stdout.write(`${summaryLine(command, verdicts, toolchain)}\n`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(error instanceof UsageError ? 2 : 1);
    },
  );
}
