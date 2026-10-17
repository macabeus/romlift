// g5.c-data-ranges (architecture §6.6, §8.1, §13, D21): with a data range, a C array replaces its slice of
// the ROM and the build still matches. On the c-data fixture, after `init`, the gate copies the fixture's
// decompiled C (the file that defines a `const` array) over the project and writes by hand the module's
// `data_start` that bench/dataset/synthetic/c-data/expect-ranges.json names; then `generate`, `./setup.sh`
// and `make` must reach the SHA-1, the array must be defined by src/<module>.o (a data or read-only
// symbol of its size), and in the linked ELF it must sit at its address in the ROM.
//
// Expected interfaces, for the phase-5 lead to align (architecture §6.5, §6.6, §8.1):
//   bench/dataset/synthetic/c-data/expect-ranges.json   {"module": string, "dataStart": "0x…",
//     "symbol": string, "addr": "0x…", "size": number}
//   bench/dataset/synthetic/c-data/overlay/src/<module>.c   the decompiled C with the array
//   the build leaves one linked *.elf in the project root or in build/; setup.sh honours $ROMLIFT_CLI and
//   <name>.sha1 is in sha1sum format (as in g4.e2e-fixtures)
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface Ranges {
  readonly module: string;
  readonly dataStart: string;
  readonly symbol: string;
  readonly addr: string;
  readonly size: number;
}

const FIXTURE = 'c-data';
const DATA_TYPES: ReadonlySet<string> = new Set(['r', 'R', 'd', 'D']);

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

async function sourceCli(cx: GateContext): Promise<string> {
  const dir = await cx.tmpDir('romlift-cli-');
  const shim = path.join(dir, 'romlift');
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await writeFile(shim, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${main}' "$@"\n`, { mode: 0o755 });
  return shim;
}

async function step(cx: GateContext, what: string, command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>): Promise<ExecResult> {
  const run = await cx.exec(command, args, { cwd, env });
  if (run.code !== 0) throw new Error(`${what} exited ${run.code}:\n${tail(run)}`);
  return run;
}

function addToModule(text: string, module: string, extra: readonly string[]): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== '[[modules]]') continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) end++;
    if (!lines.slice(i + 1, end).some((l) => l.trim() === `name = "${module}"`)) continue;
    const kind = lines.slice(i + 1, end).findIndex((l) => /^\s*kind\s*=/.test(l));
    if (kind < 0) throw new Error(`module ${module} has no kind line`);
    return [...lines.slice(0, i + 2 + kind), ...extra, ...lines.slice(i + 2 + kind)].join('\n');
  }
  throw new Error(`romlift.toml has no [[modules]] block named ${module}`);
}

/** `name -> {value, size, type}` from `nm -S --defined-only`. */
async function symbols(cx: GateContext, file: string, cwd: string): Promise<ReadonlyMap<string, { readonly value: number; readonly size: number; readonly type: string }>> {
  const nm = await step(cx, `nm ${file}`, 'arm-none-eabi-nm', ['-S', '--defined-only', file], cwd, {});
  const out = new Map<string, { value: number; size: number; type: string }>();
  for (const line of nm.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 4 && parts[3] !== undefined) out.set(parts[3], { value: Number.parseInt(parts[0] ?? '', 16), size: Number.parseInt(parts[1] ?? '', 16), type: parts[2] ?? '' });
    else if (parts.length === 3 && parts[2] !== undefined) out.set(parts[2], { value: Number.parseInt(parts[0] ?? '', 16), size: 0, type: parts[1] ?? '' });
  }
  return out;
}

async function linkedElf(dir: string): Promise<string> {
  const found: string[] = [];
  for (const sub of ['', 'build']) for (const n of await readdir(path.join(dir, sub)).catch(() => [] as string[])) if (n.endsWith('.elf')) found.push(path.join(sub, n));
  if (found.length !== 1 || found[0] === undefined) throw new Error(`the build left ${found.length} .elf files in the project root and build/, expected one`);
  return found[0];
}

gate({
  id: 'g5.c-data-ranges',
  phase: 5,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate', 'buildModel'],
  async run(cx) {
    const fixture = cx.fixtures.find((f) => f.name === FIXTURE);
    if (fixture === undefined) throw new Error(`no ${FIXTURE} fixture under bench/dataset/synthetic`);
    const ranges = JSON.parse(await readFile(path.join(fixture.dir, 'expect-ranges.json'), 'utf8')) as Ranges;
    const cli = await sourceCli(cx);
    const env = { ROMLIFT_CLI: cli };
    const dir = path.join(await cx.tmpDir('romlift-c-data-ranges-'), FIXTURE);
    await mkdir(dir, { recursive: true });
    await copyFile(fixture.rom, path.join(dir, 'baserom.gba'));
    await step(cx, 'init', cli, ['init', 'baserom.gba', '--json'], dir, env);
    const tomlPath = path.join(dir, 'romlift.toml');
    await writeFile(tomlPath, addToModule(await readFile(tomlPath, 'utf8'), ranges.module, [`data_start = ${ranges.dataStart}`]));
    await cp(path.join(fixture.dir, 'overlay'), dir, { recursive: true });
    await step(cx, 'generate', cli, ['generate', '--json'], dir, env);
    await step(cx, './setup.sh', './setup.sh', [], dir, env);
    await step(cx, 'make', 'make', [], dir, env);

    const expected = sha1(await readFile(fixture.rom));
    const sha1Name = (await readdir(dir)).find((n) => n.endsWith('.sha1'));
    const match = sha1Name === undefined ? null : /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, sha1Name), 'utf8'));
    const built = match?.[2] === undefined ? undefined : path.join(dir, match[2]);
    const actual = built !== undefined && (await exists(built)) ? sha1(await readFile(built)) : 'nothing';
    if (actual !== expected) throw new Error(`with a data range, make built ${actual}, expected ${expected}`);

    const object = path.join('src', `${ranges.module}.o`);
    const defined = (await symbols(cx, object, dir)).get(ranges.symbol);
    if (defined === undefined || !DATA_TYPES.has(defined.type)) throw new Error(`${object} does not define ${ranges.symbol} as data (${defined?.type ?? 'absent'})`);
    if (defined.size !== ranges.size) throw new Error(`${object} defines ${ranges.symbol} with ${defined.size} bytes, expected ${ranges.size}`);
    const linked = (await symbols(cx, await linkedElf(dir), dir)).get(ranges.symbol);
    if (linked?.value !== Number.parseInt(ranges.addr, 16)) throw new Error(`the linked ${ranges.symbol} is at ${linked === undefined ? 'nowhere' : `0x${linked.value.toString(16)}`}, expected ${ranges.addr}`);
    cx.note(`${ranges.symbol} (${ranges.size} bytes) from src/${ranges.module}.c replaces its ROM slice at ${ranges.addr}; the build reaches ${expected}`);
  },
});
