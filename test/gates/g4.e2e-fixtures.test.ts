// g4.e2e-fixtures (architecture §1, §8.1, §13, R1): in a directory that holds only a fixture's ROM,
// `romlift init <rom> && ./setup.sh && make` ends at the ROM's SHA-1 with no file edited by hand, on every
// committed fixture except c-data (whose C array must fail the link: g4.c-data-fails-loud); `setup.sh` and
// `make` leave romlift.toml as `init` wrote it; the composite fixture's illegal border makes `generate`
// fail with E_MODULE_BORDER and write nothing; and the composite's assembly-only module builds from the fixture's own
// hand-written source (D109): its [[modules]] block gets `source = "hand/hand.s"` (hand.s and the macros it includes
// copied into the project), `romlift rename` gives its functions hand.s's names, and `generate` then `make` end at
// the ROM's SHA-1 with no generated file for that module.
//
// Interfaces, frozen by D74 (architecture §2.1, §6.3, §6.5, §8.1):
//   romlift init <rom> [<expect.json init.args>…] --json   run where the ROM is; exit 0
//   romlift generate --json                                exit 0; exit 1 with the composite's illegal border
//   NDJSON on stdout: {"type":"diagnostic","code":string,"severity":string,"message":string} (any number),
//   then {"type":"summary","ok":boolean,"exitCode":number} (last line).
//   setup.sh runs romlift as `$ROMLIFT_CLI` when it is set (default `npx romlift`) and then skips its npm
//   duty, since an unpublished tree cannot come from the registry; the gate points it at the source CLI.
//   <name>.sha1 (scaffold) holds `<sha1>  <file>` in sha1sum format, where <file> is the ROM `make` builds,
//   `<name>.gba`; init copies the given ROM to baserom.gba (the config's [rom] path), keeping the original.
//   bench/dataset/synthetic/<name>/expect.json may hold {"init": {"args": [string]}} (the composite:
//   ["--module-size", "0x200"]); the composite's also holds {"illegalBorder": {"module": string,
//   "start": "0x…"}}, the start the gate writes by hand into that [[modules]] block of romlift.toml.
// The first project builds agbcc through setup.sh's duty (2); later projects get a copy of its tools/agbcc,
// which that duty then finds present, so one gate run builds the compiler once.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, type FixtureRef, type GateContext, copyAgbcc, gate, withSharedAgbcc } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly code?: string;
  readonly ok?: boolean;
  readonly exitCode?: number;
}

interface Expect {
  readonly init?: { readonly args?: readonly string[] };
  readonly illegalBorder?: { readonly module: string; readonly start: string };
}

/** Fixtures this gate does not build, each proven elsewhere. */
const NOT_BUILT: Readonly<Record<string, string>> = {
  'c-data': 'its C array must fail the link (g4.c-data-fails-loud)',
};
const COMPOSITE = 'composite';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** A `romlift` executable that runs the source CLI, for `$ROMLIFT_CLI`. */
async function sourceCli(cx: GateContext): Promise<string> {
  const dir = await cx.tmpDir('romlift-cli-');
  const shim = path.join(dir, 'romlift');
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await writeFile(shim, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${main}' "$@"\n`, { mode: 0o755 });
  return shim;
}

async function romlift(
  cx: GateContext,
  cli: string,
  cwd: string,
  args: readonly string[],
): Promise<{ readonly run: ExecResult; readonly lines: readonly CliLine[] }> {
  const run = await cx.exec(cli, [...args, '--json'], { cwd, env: { ROMLIFT_CLI: cli } });
  let lines: readonly CliLine[];
  try {
    lines = cx.jsonLines<CliLine>(run.stdout);
  } catch (error) {
    throw new Error(
      `romlift ${args.join(' ')} --json printed bad NDJSON (${error instanceof Error ? error.message : String(error)}):\n${tail(run)}`,
    );
  }
  const last = lines[lines.length - 1];
  if (last?.type !== 'summary' || last.exitCode !== run.code)
    throw new Error(`romlift ${args.join(' ')} --json exited ${run.code} without a matching summary:\n${tail(run)}`);
  return { run, lines };
}

async function readExpect(fixture: FixtureRef): Promise<Expect> {
  return (await exists(fixture.expect)) ? (JSON.parse(await readFile(fixture.expect, 'utf8')) as Expect) : {};
}

/** The SHA-1 and the ROM file named by the project's `<name>.sha1`. */
async function sha1File(dir: string): Promise<{ readonly sha1: string; readonly file: string }> {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith('.sha1'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (names.length !== 1 || names[0] === undefined)
    throw new Error(`${dir} holds ${names.length} .sha1 files, the scaffold writes one`);
  const match = /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8'));
  if (match?.[1] === undefined || match[2] === undefined) throw new Error(`${names[0]} is not in sha1sum format`);
  return { sha1: match[1], file: match[2] };
}

/** Every file under `dir` except `.git` and `tools/`, as path -> sha1. */
async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (relative === '.git' || relative === 'tools') continue;
    if (entry.isDirectory()) for (const [key, value] of await snapshot(dir, relative)) out.set(key, value);
    else if (entry.isFile()) out.set(relative, sha1(await readFile(path.join(dir, relative))));
  }
  return out;
}

function changed(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): readonly string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.filter((key) => before.get(key) !== after.get(key));
}

/** Rewrites the `start` of one `[[modules]]` block of a canonical romlift.toml. */
function setModuleStart(text: string, module: string, start: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== '[[modules]]') continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) end++;
    const block = lines.slice(i + 1, end);
    if (!block.some((line) => line.trim() === `name = "${module}"`)) continue;
    const at = block.findIndex((line) => /^\s*start\s*=/.test(line));
    if (at < 0) throw new Error(`module ${module} has no start line`);
    lines[i + 1 + at] = `start = ${start}`;
    return lines.join('\n');
  }
  throw new Error(`romlift.toml has no [[modules]] block named ${module}`);
}

/** The `[[modules]]` blocks of a canonical romlift.toml: each one's name, start, kind and the line its kind is on. */
function moduleBlocks(
  text: string,
): readonly { readonly name: string; readonly start: number; readonly kind: string; readonly kindLine: number }[] {
  const lines = text.split('\n');
  const out: { name: string; start: number; kind: string; kindLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== '[[modules]]') continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) end++;
    const value = (key: string): { readonly text: string; readonly line: number } | undefined => {
      for (let k = i + 1; k < end; k++) {
        const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^"]*)"?\\s*$`).exec(lines[k] ?? '');
        if (match?.[1] !== undefined) return { text: match[1], line: k };
      }
      return undefined;
    };
    const name = value('name');
    const start = value('start');
    const kind = value('kind');
    if (name !== undefined && start !== undefined && kind !== undefined)
      out.push({ name: name.text, start: Number(start.text), kind: kind.text, kindLine: kind.line });
  }
  return out;
}

/**
 * The composite's assembly-only module built from the fixture's own hand-written source, hand.s (D109), in the project
 * `dir` whose romlift.toml is `toml` (init's): the module gets `source`, its functions get hand.s's names through
 * `romlift rename`, then `generate` and `make` must reach the ROM's SHA-1. Returns why not, or undefined.
 */
async function handWritten(
  cx: GateContext,
  cli: string,
  fixture: FixtureRef,
  dir: string,
  toml: string,
): Promise<string | undefined> {
  const blocks = moduleBlocks(toml);
  const asm = blocks.filter((b) => b.kind === 'asm' && b.name !== 'rom_header' && b.name !== 'crt0');
  const module = asm[0];
  if (asm.length !== 1 || module === undefined)
    return `hand-written source: expected one assembly-only module, init wrote ${asm.length} (${asm.map((b) => b.name).join(', ')})`;
  const end = blocks.find((b) => b.start > module.start)?.start ?? Infinity;
  // hand.s, its include rewritten to the copy of the macros beside it.
  const source = (await readFile(path.join(fixture.dir, 'hand.s'), 'utf8')).replace(
    '.include "../common/macros.inc"',
    '.include "hand/macros.inc"',
  );
  if (!source.includes('.include "hand/macros.inc"'))
    return 'hand-written source: hand.s no longer includes ../common/macros.inc';
  await mkdir(path.join(dir, 'hand'), { recursive: true });
  await writeFile(path.join(dir, 'hand', 'hand.s'), source);
  await copyFile(path.join(fixture.dir, '..', 'common', 'macros.inc'), path.join(dir, 'hand', 'macros.inc'));
  const lines = toml.split('\n');
  lines.splice(module.kindLine + 1, 0, 'source = "hand/hand.s"');
  await writeFile(path.join(dir, 'romlift.toml'), lines.join('\n'));
  // hand.s's functions in its order, which is their ROM order; the module's [functions] entries in address order.
  const names = [
    ...source.matchAll(/^\s*(?:thumb_func_start|non_word_aligned_thumb_func_start|arm_func_start)\s+(\w+)/gm),
  ].map((m) => m[1] ?? '');
  const listed = [...toml.matchAll(/^(0x[0-9A-F]{8}) = (?:"(\w+)"|\{ name = "(\w+)")/gm)]
    .map((m) => ({ addr: Number(m[1]), name: m[2] ?? m[3] ?? '' }))
    .filter((f) => f.addr >= module.start && f.addr < end)
    .sort((a, b) => a.addr - b.addr);
  if (names.length === 0 || names.length !== listed.length)
    return `hand-written source: hand.s defines ${names.length} functions, ${module.name} lists ${listed.length}`;
  for (const [i, f] of listed.entries()) {
    const renamed = await romlift(cx, cli, dir, ['rename', f.name, names[i] ?? '']);
    if (renamed.run.code !== 0)
      return `rename ${f.name} ${names[i] ?? ''} exited ${renamed.run.code}:\n${tail(renamed.run)}`;
  }
  const generate = await romlift(cx, cli, dir, ['generate']);
  if (generate.run.code !== 0)
    return `generate with ${module.name}'s hand-written source exited ${generate.run.code}:\n${tail(generate.run)}`;
  if (await exists(path.join(dir, 'asm', `${module.name}.s`)))
    return `generate left asm/${module.name}.s beside the hand-written source`;
  const make = await cx.exec('make', [], { cwd: dir, env: { ROMLIFT_CLI: cli } });
  if (make.code !== 0) return `make with ${module.name}'s hand-written source exited ${make.code}:\n${tail(make)}`;
  const target = await sha1File(dir);
  const actual = sha1(await readFile(path.join(dir, target.file)));
  return actual === target.sha1
    ? undefined
    : `make with ${module.name}'s hand-written source built SHA-1 ${actual}, expected ${target.sha1}`;
}

/** One fixture's share of the gate's report: why its build did not reach the SHA-1 (or undefined), its notes, and the tools/agbcc its setup.sh built, if it built one. */
interface Built {
  readonly failure: string | undefined;
  readonly notes: readonly string[];
  readonly agbcc?: string | undefined;
}

/** init, setup.sh and make in `dir`; returns why the build did not reach the SHA-1, or undefined. */
async function build(
  cx: GateContext,
  cli: string,
  fixture: FixtureRef,
  dir: string,
  args: readonly string[],
  agbcc: string | undefined,
  notes: string[],
): Promise<string | undefined> {
  const expected = sha1(await readFile(fixture.rom));
  await mkdir(dir, { recursive: true });
  const rom = `${fixture.name}.gba`;
  await copyFile(fixture.rom, path.join(dir, rom));
  const init = await romlift(cx, cli, dir, ['init', rom, ...args]);
  if (init.run.code !== 0) return `init exited ${init.run.code}:\n${tail(init.run)}`;
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const before = await snapshot(dir);
  if (agbcc !== undefined) await copyAgbcc(agbcc, dir);
  const env = { ROMLIFT_CLI: cli };
  const setup = await cx.exec('./setup.sh', [], { cwd: dir, env });
  if (setup.code !== 0) return `./setup.sh exited ${setup.code}:\n${tail(setup)}`;
  const make = await cx.exec('make', [], { cwd: dir, env });
  if (make.code !== 0) return `make exited ${make.code}:\n${tail(make)}`;
  if ((await readFile(path.join(dir, 'romlift.toml'), 'utf8')) !== toml) return 'setup.sh or make changed romlift.toml';
  const lost = changed(before, await snapshot(dir)).filter(
    (file) => before.has(file) && file !== rom && !file.startsWith('asm/') && !file.startsWith('data/'),
  );
  if (lost.length > 0) notes.push(`${fixture.name}: files setup.sh or make rewrote: ${lost.slice(0, 8).join(', ')}`);
  const target = await sha1File(dir);
  if (target.sha1 !== expected) return `${fixture.name}.sha1 records ${target.sha1}, the ROM is ${expected}`;
  const built = path.join(dir, target.file);
  if (!(await exists(built))) return `make did not build ${target.file}`;
  const actual = sha1(await readFile(built));
  return actual === expected ? undefined : `make built ${target.file} with SHA-1 ${actual}, expected ${expected}`;
}

gate({
  id: 'g4.e2e-fixtures',
  phase: 4,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate'],
  async run(cx) {
    const composite = cx.fixtures.find((f) => f.name === COMPOSITE);
    if (composite === undefined) throw new Error(`no ${COMPOSITE} fixture under bench/dataset/synthetic`);
    const cli = await sourceCli(cx);
    const base = await cx.tmpDir('romlift-e2e-fixtures-');
    const problems: string[] = [];
    // The first fixture built builds agbcc through setup.sh's duty 2; the rest get a copy, FIXTURE_PARALLELISM at once.
    const outcomes = await withSharedAgbcc(
      cx.fixtures,
      async (fixture, agbcc): Promise<Built & { readonly skipped: boolean }> => {
        const skip = NOT_BUILT[fixture.name];
        if (skip !== undefined)
          return { failure: undefined, notes: [`${fixture.name} not built here: ${skip}`], skipped: true };
        const dir = path.join(base, fixture.name);
        const notes: string[] = [];
        const failure = await build(cx, cli, fixture, dir, (await readExpect(fixture)).init?.args ?? [], agbcc, notes);
        const fresh =
          agbcc === undefined && (await exists(path.join(dir, 'tools', 'agbcc', 'bin', 'agbcc')))
            ? path.join(dir, 'tools', 'agbcc')
            : undefined;
        return { failure, notes, agbcc: fresh, skipped: false };
      },
    );
    for (const [i, o] of outcomes.entries()) {
      for (const note of o.notes) cx.note(note);
      if (o.failure !== undefined) problems.push(`${cx.fixtures[i]?.name ?? '?'}: ${o.failure}`);
    }
    const built = outcomes.filter((o) => !o.skipped && o.failure === undefined).length;

    const border = (await readExpect(composite)).illegalBorder;
    if (border === undefined) {
      problems.push(`${COMPOSITE}/expect.json names no illegalBorder`);
    } else {
      const dir = path.join(base, COMPOSITE);
      if (await exists(path.join(dir, 'romlift.toml'))) {
        const file = path.join(dir, 'romlift.toml');
        const original = await readFile(file, 'utf8');
        await writeFile(file, setModuleStart(original, border.module, border.start));
        const before = await snapshot(dir);
        const generate = await romlift(cx, cli, dir, ['generate']);
        const codes = generate.lines.filter((l) => l.type === 'diagnostic').map((l) => l.code ?? '');
        if (generate.run.code !== 1 || !codes.includes('E_MODULE_BORDER')) {
          problems.push(
            `${COMPOSITE}: module ${border.module} at ${border.start} gave exit ${generate.run.code} and codes [${codes.join(', ')}], expected exit 1 with E_MODULE_BORDER`,
          );
        }
        const touched = changed(before, await snapshot(dir));
        if (touched.length > 0)
          problems.push(`${COMPOSITE}: the refused generate changed ${touched.slice(0, 8).join(', ')}`);
        await writeFile(file, original);
        const hand = await handWritten(cx, cli, composite, dir, original);
        if (hand !== undefined) problems.push(`${COMPOSITE}: ${hand}`);
      } else {
        problems.push(`${COMPOSITE}: no project to move the border in`);
      }
    }
    if (problems.length > 0) throw new Error(`end to end on the fixtures: ${problems.join(' | ')}`);
    cx.note(
      `${built} fixtures built to their SHA-1 from init, setup.sh and make; the composite's illegal border fails with E_MODULE_BORDER; its assembly-only module builds from its hand-written source`,
    );
  },
});
