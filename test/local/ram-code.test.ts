// Code that runs from RAM, end to end (architecture §3.3, §6.7, D46, D91; roadmap 6.C): a hand-written [[overrides]]
// entry with runs_at, appended to the romlift.toml `init` wrote, the way g6.ram-code-mapped appends it, on the RAM-copy
// fixture (its expect.json's `ramCopy`, IwramDouble loaded at 0x0800012C and run at 0x03000000) and on klonoa
// (bench/overrides/klonoa.json, SoundMainRAM loaded at 0x0804F318 and run at 0x03000388). For each: `init`,
// `update --write --json` (exit 0), the project's model (encodeModel in process; one module spans exactly the range, with its runAt, and
// the functions inside it carry their run address), `generate`, `./setup.sh` and `make` to the ROM's SHA-1.
//
// The words that hold a load address inside the range (the copy's source: klonoa's m4aSoundInit loads 0x0804F319,
// SoundMainRAM | 1, for its CpuCopy32) must keep their bytes now that the code links at its run address: no pool
// line of the tree may print one as the name of a label inside the range, which would link to the run address; each
// prints as its value or through `__load_<module>`, and the SHA-1 then proves the bytes.
//
// Inputs: the fixture's committed ROM; klonoa's ROM from its dataset; agbcc from ROMLIFT_AGBCC, else bench/.local/agbcc,
// else $ROMLIFT_BENCH_ROOT/pokeemerald/tools/agbcc, else setup.sh builds it at the pin (network); binutils. A missing ROM
// makes its case `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1. test/local imports only the entry points and
// node (architecture §2), so the loop is spelled here.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

/** One hand-written runs_at range. */
interface RamRange {
  readonly start: number;
  readonly size: number;
  readonly runAt: number;
  readonly mode?: 'thumb' | 'arm';
}

function num(value: unknown, what: string): number {
  if (typeof value === 'string' && /^0x[0-9A-Fa-f]+$/.test(value)) return Number.parseInt(value.slice(2), 16);
  throw new Error(`${what} is not a 0x… address (${JSON.stringify(value)})`);
}

function rangeOf(value: Readonly<Record<string, unknown>>, runAtKey: 'runAt' | 'runsAt', what: string): RamRange {
  const mode = value['mode'];
  const base = {
    start: num(value['start'], `${what}.start`),
    size: num(value['size'], `${what}.size`),
    runAt: num(value[runAtKey], `${what}.${runAtKey}`),
  };
  return mode === 'thumb' || mode === 'arm' ? { ...base, mode } : base;
}

function hex(a: number): string {
  return `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;
}

const FIXTURE = path.join(REPO, 'bench', 'dataset', 'synthetic', 'code-copied-to-ram');
const FIXTURE_ROM = path.join(FIXTURE, 'build', 'code-copied-to-ram.gba');
const fixtureRange = rangeOf(
  (
    JSON.parse(readFileSync(path.join(FIXTURE, 'expect.json'), 'utf8')) as {
      readonly ramCopy: Readonly<Record<string, unknown>>;
    }
  ).ramCopy,
  'runAt',
  'expect.json ramCopy',
);

const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as {
  readonly rom: string;
  readonly sha1: string;
};
const KLONOA_ROM = path.join(BENCH_ROOT, dataset.rom);
const klonoaConfig = JSON.parse(readFileSync(path.join(REPO, 'bench', 'overrides', 'klonoa.json'), 'utf8')) as {
  readonly schema: number;
  readonly overrides: readonly Readonly<Record<string, unknown>>[];
  readonly source: string;
};
const klonoaRanges = klonoaConfig.overrides.map((o, i) =>
  rangeOf(o, 'runsAt', `bench/overrides/klonoa.json overrides[${i}]`),
);

/** The first agbcc build found (a directory holding bin/agbcc), or undefined: setup.sh then builds it. */
function prebuiltAgbcc(): string | undefined {
  const env = process.env['ROMLIFT_AGBCC'];
  const candidates = [
    ...(env ? [path.resolve(REPO, env)] : []),
    path.join(REPO, 'bench', '.local', 'agbcc'),
    path.join(BENCH_ROOT, 'pokeemerald', 'tools', 'agbcc'),
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'bin', 'agbcc')));
}

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-ram-code-'));
after(() => rm(TMP, { recursive: true, force: true }));

interface Ran {
  readonly code: number;
  readonly out: string;
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>> = {},
): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, out: `${stdout}${stderr}` });
      },
    );
  });
}

function tail(ran: Ran, lines = 25): string {
  return ran.out.trimEnd().split('\n').slice(-lines).join('\n');
}

async function sourceCli(): Promise<string> {
  const cli = path.join(TMP, 'romlift');
  await writeFile(
    cli,
    `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${path.join(REPO, 'src', 'cli', 'main.ts')}' "$@"\n`,
  );
  await chmod(cli, 0o755);
  return cli;
}

function overrideBlock(r: RamRange): string {
  return `\n[[overrides]]\nstart = ${hex(r.start)}\nsize = 0x${r.size.toString(16).toUpperCase()}\nkind = "code"\n${r.mode === undefined ? '' : `mode = "${r.mode}"\n`}runs_at = ${hex(r.runAt)}\n`;
}

/** Every `.s` file under `dir`, recursively. */
async function asmFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await asmFiles(p)));
    else if (entry.name.endsWith('.s')) out.push(p);
  }
  return out;
}

interface ModelModule {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly runAt?: number;
}

/** The modules and functions of the model's header line, addresses as numbers. */
/** The project's model in `dir` as romlift/model-json@1 NDJSON, in process (readProject, confirmProject, encodeModel; D108). */
async function projectModel(dir: string): Promise<string> {
  const { confirmProject, encodeModel } = await import('romlift');
  const { readProject } = await import('romlift/node');
  const read = await readProject(dir, { withoutC: true });
  assert.ok(read.ok, `readProject ${dir}: ${read.ok ? '' : read.diagnostics.map((d) => d.message).join('; ')}`);
  const confirmed = confirmProject(read.value.inputs);
  assert.ok(
    confirmed.ok,
    `confirmProject ${dir}: ${confirmed.ok ? '' : confirmed.diagnostics.map((d) => d.message).join('; ')}`,
  );
  return [...encodeModel(confirmed.model, read.value.inputs.rom)].join('');
}

function modelOf(stdout: string): {
  readonly modules: readonly ModelModule[];
  readonly functions: readonly { readonly entry: number; readonly runAt?: number }[];
} {
  const header = JSON.parse(stdout.split('\n')[0] ?? '{}') as {
    readonly modules: readonly {
      readonly name: string;
      readonly span: { readonly start: unknown; readonly end: unknown };
      readonly runAt?: unknown;
    }[];
    readonly functions: readonly { readonly entry: unknown; readonly runAt?: unknown }[];
  };
  return {
    modules: header.modules.map((m) => ({
      name: m.name,
      start: num(m.span.start, 'span.start'),
      end: num(m.span.end, 'span.end'),
      ...(m.runAt === undefined ? {} : { runAt: num(m.runAt, 'runAt') }),
    })),
    functions: header.functions.map((f) => ({
      entry: num(f.entry, 'entry'),
      ...(f.runAt === undefined ? {} : { runAt: num(f.runAt, 'runAt') }),
    })),
  };
}

/**
 * The ROM's aligned words holding a load address inside `range` (with or without the Thumb bit), by address: the
 * copy's source and anything else that names those bytes where they are loaded.
 */
function loadWords(rom: Uint8Array, range: RamRange): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  const view = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  for (let off = 0; off + 4 <= rom.length; off += 4) {
    const v = view.getUint32(off, true);
    const a = v & ~1;
    if (a >= range.start && a < range.start + range.size) out.set(0x0800_0000 + off, v);
  }
  return out;
}

async function rebuild(name: string, romPath: string, ranges: readonly RamRange[], sha1: string): Promise<void> {
  const [range] = ranges;
  assert.ok(range !== undefined, `${name}: no range`);
  const cli = await sourceCli();
  const env = { ROMLIFT_CLI: cli };
  const dir = path.join(TMP, name);
  await mkdir(dir, { recursive: true });
  await copyFile(romPath, path.join(dir, 'baserom.gba'));
  const init = await run(cli, ['init', 'baserom.gba', '--json'], dir);
  assert.equal(init.code, 0, tail(init));
  for (const r of ranges) await appendFile(path.join(dir, 'romlift.toml'), overrideBlock(r));
  const update = await run(cli, ['update', '--write', '--json'], dir, env);
  assert.equal(update.code, 0, tail(update));

  const { modules, functions } = modelOf(await projectModel(dir));
  const end = range.start + range.size;
  const own = modules.filter((m) => m.start < end && m.end > range.start);
  assert.deepEqual(
    own.map((m) => [m.start, m.end, m.runAt]),
    [[range.start, end, range.runAt]],
    `${name}: one module spans exactly ${hex(range.start)}..${hex(end)}, run at ${hex(range.runAt)}`,
  );
  const inside = functions.filter((f) => f.entry >= range.start && f.entry < end);
  assert.ok(
    inside.some((f) => f.entry === range.start),
    `${name}: the range's start is a function`,
  );
  for (const f of inside)
    assert.equal(f.runAt, range.runAt + (f.entry - range.start), `${name}: ${hex(f.entry)} runs at its run address`);
  for (const f of functions.filter((g) => g.entry < range.start || g.entry >= end))
    assert.equal(f.runAt, undefined, `${name}: ${hex(f.entry)} runs where it is loaded`);

  const generate = await run(cli, ['generate', '--json'], dir, env);
  assert.equal(generate.code, 0, tail(generate));
  const ldscript = await readFile(path.join(dir, 'ldscript.txt'), 'utf8');
  const module = own[0]?.name ?? '';
  assert.ok(
    ldscript.includes(`.${module} ${hex(range.runAt)} : AT(${hex(range.start)})`),
    `${name}: ldscript.txt places .${module} at its run address\n${ldscript}`,
  );
  assert.ok(
    ldscript.includes(`__load_${module} = LOADADDR(.${module});`),
    `${name}: ldscript.txt defines __load_${module}`,
  );

  // The words naming the range where it is loaded keep their bytes: never a label inside the range (its run address).
  const bytes = readFileSync(romPath);
  const named = loadWords(bytes, range);
  const texts = await Promise.all((await asmFiles(dir)).map((f) => readFile(f, 'utf8')));
  let printed = 0;
  for (const [at, value] of named) {
    const line = new RegExp(`^_${at.toString(16).toUpperCase().padStart(8, '0')}: \\.4byte (\\S.*)$`, 'm');
    const operand = texts.map((t) => line.exec(t)?.[1]).find((o) => o !== undefined);
    if (operand === undefined) continue;
    printed++;
    assert.ok(
      operand === hex(value) || operand.startsWith(`__load_${module}`),
      `${name}: the word at ${hex(at)} (${hex(value)}) prints as ${operand}, which would not link to its own bytes`,
    );
  }
  if (name === 'klonoa')
    assert.ok(
      printed >= 1 && named.get(0x0804_ff98) === 0x0804_f319,
      'klonoa: m4aSoundInit loads SoundMainRAM | 1 from its pool, and that pool word is printed',
    );

  const prebuilt = prebuiltAgbcc();
  for (const part of ['bin', 'include', 'lib'])
    if (prebuilt !== undefined && existsSync(path.join(prebuilt, part)))
      await cp(path.join(prebuilt, part), path.join(dir, 'tools', 'agbcc', part), { recursive: true });
  const setup = await run('./setup.sh', [], dir, env);
  assert.equal(setup.code, 0, tail(setup));
  const make = await run('make', [], dir, env);
  assert.equal(make.code, 0, tail(make));
  const buildName = /^name = "([^"]+)"$/m.exec(await readFile(path.join(dir, 'romlift.toml'), 'utf8'))?.[1] ?? '';
  const built =
    /^[0-9a-f]{40}\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, `${buildName}.sha1`), 'utf8'))?.[1] ?? '';
  assert.equal(
    createHash('sha1')
      .update(readFileSync(path.join(dir, built)))
      .digest('hex'),
    sha1,
    `${name}: make built another ROM`,
  );
}

test(
  'the RAM-copy fixture: its runs_at range is its own module at 0x03000000 and the tree links to the SHA-1',
  { timeout: 30 * 60_000 },
  async () => {
    const bytes = readFileSync(FIXTURE_ROM);
    await rebuild('code-copied-to-ram', FIXTURE_ROM, [fixtureRange], createHash('sha1').update(bytes).digest('hex'));
  },
);

const unavailable = existsSync(KLONOA_ROM) ? undefined : `unavailable: rom ${KLONOA_ROM}`;

test(
  "klonoa: SoundMainRAM's range from bench/overrides/klonoa.json runs at 0x03000388 and the tree links to the SHA-1",
  { skip: REQUIRE ? false : (unavailable ?? false), timeout: 60 * 60_000 },
  async () => {
    assert.equal(unavailable, undefined, unavailable);
    assert.equal(klonoaConfig.schema, 1);
    assert.deepEqual(
      klonoaRanges.map((r) => [r.start, r.runAt]),
      [[0x0804_f318, 0x0300_0388]],
    );
    assert.equal(dataset.sha1, 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b');
    await rebuild('klonoa', KLONOA_ROM, klonoaRanges, dataset.sha1);
  },
);
