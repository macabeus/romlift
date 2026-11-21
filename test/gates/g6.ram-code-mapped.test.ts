// g6.ram-code-mapped (architecture §3.3, §6.7, §13, D46, D91): code that runs from RAM links at its run address and
// still rebuilds the ROM. The range is given by hand, as an [[overrides]] entry with runs_at: the gba-kit trace that
// would have proposed it was dropped by the owner (D91: "I think we can skip this part of the plan, since very few
// functions are called and found by gba-kit"), so no trace runs here.
//   ci:   on every committed fixture whose expect.json has `ramCopy`, the gate appends that [[overrides]] entry (kind
//         "code", runs_at, and mode when given) to the romlift.toml `init` wrote; `update --write` proposes
//         the range's two module borders; then the model has one module spanning exactly the range with that runAt,
//         ldscript.txt places it with AT(...) and defines __load_<module>, and setup.sh and make reach the SHA-1;
//   real: the same on Klonoa, with the [[overrides]] entries of bench/overrides/klonoa.json (the BIOS copy of the m4a
//         mixer, 0x0804F318 -> 0x03000388, written by p6-ram-code), to the dataset's SHA-1.
//
// Expected interfaces, aligned by the phase-6 lead (architecture §2.1, §3.4, §6.5, §6.7, D93):
//   expect.json {"ramCopy": {"start": "0x…", "size": "0x…", "runAt": "0x…", "mode"?: "thumb"|"arm"}}
//   bench/overrides/klonoa.json {"schema": 1, "overrides": [{"start": "0x0804F318", "size": "0x…", "kind": "code",
//     "mode"?: "arm", "runsAt": "0x03000388"}], "source": string}
//   romlift update --write --json   exit 0; then the project's model (readProject, confirmProject, encodeModel), whose
//     first line is {"schema":"romlift/model-json@1","modules":[{"name","span":{"start","end"},"runAt"?},…]}
//   setup.sh honours $ROMLIFT_CLI and <name>.sha1 is in sha1sum format (as in g4.e2e-fixtures)
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, type GateContext, gate } from './gate.ts';

type Mode = 'thumb' | 'arm';

/** One hand-written [[overrides]] entry with runs_at, as a fixture's expect.json or the bench config gives it. */
interface RamOverride {
  readonly start: number;
  readonly size: number;
  readonly runAt: number;
  readonly mode?: Mode;
}

/** encodeModel's first line: addresses are "0x…" strings (romlift/model-json@1), read with num(). */
interface ModelHeader {
  readonly schema: string;
  readonly modules: readonly {
    readonly name: string;
    readonly span: { readonly start: unknown; readonly end: unknown };
    readonly runAt?: unknown;
  }[];
}

interface Case {
  readonly name: string;
  readonly rom: string;
  /** The overrides appended after init; the first is the range the gate judges. */
  readonly overrides: readonly RamOverride[];
}

const KLONOA = { start: 0x0804_f318, runAt: 0x0300_0388 } as const;
const KLONOA_OVERRIDES = path.join('bench', 'overrides', 'klonoa.json');

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function num(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^0x[0-9A-Fa-f]+$/.test(value)) return Number.parseInt(value.slice(2), 16);
  throw new Error(`${what} is not an address or size (${JSON.stringify(value)})`);
}

function modeOf(value: unknown, what: string): Mode | undefined {
  if (value === undefined) return undefined;
  if (value === 'thumb' || value === 'arm') return value;
  throw new Error(`${what} is not 'thumb' or 'arm' (${JSON.stringify(value)})`);
}

function ramOverride(
  value: Readonly<Record<string, unknown>>,
  runAtKey: 'runAt' | 'runsAt',
  what: string,
): RamOverride {
  const mode = modeOf(value['mode'], `${what}.mode`);
  const base = {
    start: num(value['start'], `${what}.start`),
    size: num(value['size'], `${what}.size`),
    runAt: num(value[runAtKey], `${what}.${runAtKey}`),
  };
  return mode === undefined ? base : { ...base, mode };
}

/** The [[overrides]] entries of bench/overrides/klonoa.json, checked against the shape p6-ram-code writes. */
async function klonoaOverrides(cx: GateContext): Promise<readonly RamOverride[]> {
  const file = path.join(cx.repoRoot, KLONOA_OVERRIDES);
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text === undefined)
    throw new Error(`${KLONOA_OVERRIDES} is missing (the bench config of Klonoa's RAM code, p6-ram-code)`);
  const json = JSON.parse(text) as {
    readonly schema?: unknown;
    readonly overrides?: unknown;
    readonly source?: unknown;
  };
  if (json.schema !== 1 || !Array.isArray(json.overrides) || typeof json.source !== 'string')
    throw new Error(`${KLONOA_OVERRIDES} is not {"schema": 1, "overrides": [...], "source": string}`);
  const entries = (json.overrides as readonly Readonly<Record<string, unknown>>[]).map((o, i) => {
    if (o['kind'] !== 'code') throw new Error(`${KLONOA_OVERRIDES} overrides[${i}] is not kind "code"`);
    return ramOverride(o, 'runsAt', `${KLONOA_OVERRIDES} overrides[${i}]`);
  });
  const mixer = entries.find((o) => o.start === KLONOA.start);
  if (mixer?.runAt !== KLONOA.runAt)
    throw new Error(`${KLONOA_OVERRIDES} gives no override ${hex(KLONOA.start)} -> ${hex(KLONOA.runAt)}`);
  return [mixer, ...entries.filter((o) => o !== mixer)];
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

async function step(
  cx: GateContext,
  what: string,
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<ExecResult> {
  const run = await cx.exec(command, args, { cwd, env });
  if (run.code !== 0) throw new Error(`${what} exited ${run.code}:\n${tail(run)}`);
  return run;
}

/** The (start, runs_at) of every [[overrides]] block of a romlift.toml. */
function overrides(toml: string): readonly { readonly start: number; readonly runsAt?: number }[] {
  return toml
    .split(/^\s*\[\[overrides\]\]\s*$/m)
    .slice(1)
    .flatMap((block) => {
      const body = block.split(/^\s*\[/m)[0] ?? '';
      const start = /^\s*start\s*=\s*(0x[0-9A-Fa-f]+)/m.exec(body)?.[1];
      const runsAt = /^\s*runs_at\s*=\s*(0x[0-9A-Fa-f]+)/m.exec(body)?.[1];
      if (start === undefined) return [];
      return [
        runsAt === undefined
          ? { start: Number.parseInt(start, 16) }
          : { start: Number.parseInt(start, 16), runsAt: Number.parseInt(runsAt, 16) },
      ];
    });
}

type ReadProject = (
  dir: string,
  options: { readonly withoutC: boolean },
) => Promise<
  | { readonly ok: true; readonly value: { readonly inputs: { readonly rom: unknown } } }
  | { readonly ok: false; readonly diagnostics: readonly { readonly message: string }[] }
>;
type ConfirmProject = (
  inputs: unknown,
) =>
  | { readonly ok: true; readonly model: unknown }
  | { readonly ok: false; readonly diagnostics: readonly { readonly message: string }[] };
type EncodeModel = (model: unknown, rom: unknown) => Iterable<string>;

/** The project's model in `dir` as romlift/model-json@1 NDJSON: readProject, confirmProject, encodeModel (D108). */
async function projectModel(cx: GateContext, dir: string): Promise<string> {
  const read = await cx.need<ReadProject>('readProject')(dir, { withoutC: true });
  if (!read.ok) throw new Error(`readProject ${dir}: ${read.diagnostics.map((d) => d.message).join('; ')}`);
  const confirmed = cx.need<ConfirmProject>('confirmProject')(read.value.inputs);
  if (!confirmed.ok)
    throw new Error(`confirmProject ${dir}: ${confirmed.diagnostics.map((d) => d.message).join('; ')}`);
  return [...cx.need<EncodeModel>('encodeModel')(confirmed.model, read.value.inputs.rom)].join('');
}

function overrideBlock(o: RamOverride): string {
  return `\n[[overrides]]\nstart = ${hex(o.start)}\nsize = 0x${o.size.toString(16).toUpperCase()}\nkind = "code"\n${o.mode === undefined ? '' : `mode = "${o.mode}"\n`}runs_at = ${hex(o.runAt)}\n`;
}

async function check(cx: GateContext, cli: string, c: Case, dir: string): Promise<readonly string[]> {
  const [range] = c.overrides;
  if (range === undefined) return ['no override to judge'];
  const env = { ROMLIFT_CLI: cli };
  await mkdir(dir, { recursive: true });
  await copyFile(c.rom, path.join(dir, 'baserom.gba'));
  await step(cx, 'init', cli, ['init', 'baserom.gba', '--json'], dir, env);
  const tomlPath = path.join(dir, 'romlift.toml');
  for (const o of c.overrides) await appendFile(tomlPath, overrideBlock(o));
  await step(cx, 'update --write', cli, ['update', '--write', '--json'], dir, env);
  const problems: string[] = [];
  const listed = overrides(await readFile(tomlPath, 'utf8')).find((o) => o.start === range.start);
  if (listed?.runsAt !== range.runAt)
    problems.push(`romlift.toml has no override at ${hex(range.start)} with runs_at ${hex(range.runAt)}`);
  await step(cx, 'generate', cli, ['generate', '--json'], dir, env);
  const header = JSON.parse((await projectModel(cx, dir)).split('\n')[0] ?? '{}') as ModelHeader;
  const modules = header.modules.map((m) => ({
    name: m.name,
    span: {
      start: num(m.span.start, `module ${m.name} span.start`),
      end: num(m.span.end, `module ${m.name} span.end`),
    },
    runAt: m.runAt === undefined ? undefined : num(m.runAt, `module ${m.name} runAt`),
  }));
  const module = modules.find((m) => m.span.start === range.start);
  if (module === undefined) problems.push(`no module starts at ${hex(range.start)}`);
  else {
    if (module.runAt !== range.runAt)
      problems.push(
        `module ${module.name} runs at ${module.runAt === undefined ? 'its load address' : hex(module.runAt)}, expected ${hex(range.runAt)}`,
      );
    if (module.span.end !== range.start + range.size)
      problems.push(
        `module ${module.name} ends at ${hex(module.span.end)}, the range at ${hex(range.start + range.size)}`,
      );
    const ldscript = await readFile(path.join(dir, 'ldscript.txt'), 'utf8');
    const placed = ldscript
      .split('\n')
      .some(
        (l) => l.includes(`.${module.name}`) && /AT\s*\(/.test(l) && l.toLowerCase().includes(range.runAt.toString(16)),
      );
    if (!placed) problems.push(`ldscript.txt does not place .${module.name} at ${hex(range.runAt)} with AT(...)`);
    if (!ldscript.includes(`__load_${module.name}`))
      problems.push(`ldscript.txt does not define __load_${module.name}`);
  }
  await step(cx, './setup.sh', './setup.sh', [], dir, env);
  await step(cx, 'make', 'make', [], dir, env);
  const sha1Name = (await readdir(dir)).find((n) => n.endsWith('.sha1'));
  const match =
    sha1Name === undefined
      ? null
      : /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, sha1Name), 'utf8'));
  const built = match?.[2] === undefined ? undefined : path.join(dir, match[2]);
  const actual =
    built !== undefined && (await exists(built))
      ? createHash('sha1')
          .update(await readFile(built))
          .digest('hex')
      : 'nothing';
  const expected = createHash('sha1')
    .update(await readFile(c.rom))
    .digest('hex');
  if (actual !== expected) problems.push(`make built ${actual}, expected ${expected}`);
  return problems;
}

gate({
  id: 'g6.ram-code-mapped',
  phase: 6,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['updateProject', 'readProject', 'confirmProject', 'encodeModel'],
  async run(cx) {
    const cli = await sourceCli(cx);
    const base = await cx.tmpDir('romlift-ram-code-');
    const problems: string[] = [];
    let fixtures = 0;
    for (const fixture of cx.fixtures) {
      const expect = (await exists(fixture.expect))
        ? (JSON.parse(await readFile(fixture.expect, 'utf8')) as {
            readonly ramCopy?: Readonly<Record<string, unknown>>;
          })
        : {};
      if (expect.ramCopy === undefined) continue;
      fixtures++;
      const c: Case = {
        name: fixture.name,
        rom: fixture.rom,
        overrides: [ramOverride(expect.ramCopy, 'runAt', `${fixture.name} expect.json ramCopy`)],
      };
      for (const p of await check(cx, cli, c, path.join(base, fixture.name))) problems.push(`${fixture.name}: ${p}`);
    }
    if (fixtures === 0) problems.push('no committed fixture declares ramCopy in its expect.json');
    if (cx.tier === 'real') {
      const klonoa = cx.datasets.find((d) => d.name === 'klonoa');
      if (klonoa === undefined) throw new Error('no klonoa dataset');
      const c: Case = {
        name: 'klonoa',
        rom: path.resolve(cx.benchRoot, klonoa.rom),
        overrides: await klonoaOverrides(cx),
      };
      for (const p of await check(cx, cli, c, path.join(base, 'klonoa'))) problems.push(`klonoa: ${p}`);
    }
    if (problems.length > 0) throw new Error(`code run from RAM: ${problems.join(' | ')}`);
    cx.note(
      `${fixtures} RAM-copy fixtures${cx.tier === 'real' ? ` and Klonoa (${hex(KLONOA.start)} -> ${hex(KLONOA.runAt)}, ${KLONOA_OVERRIDES})` : ''} link at their run address and rebuild the ROM`,
    );
  },
});
