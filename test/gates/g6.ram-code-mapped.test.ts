// g6.ram-code-mapped (architecture §3.3, §6.7, §7.4, §13, D46): code that runs from RAM links at its run
// address and still rebuilds the ROM.
//   ci:   on every committed fixture whose expect.json has `ramCopy`, the gate adds that [[overrides]] entry
//         (kind "code", runs_at) by hand after `init`; `analyze --update --write` proposes the range's two
//         module borders; then the model has one module spanning exactly the range with that runAt,
//         ldscript.txt places it with AT(...) and defines __load_<module>, and setup.sh and make reach the
//         SHA-1;
//   real: on Klonoa, `romlift trace` records the copy, `analyze --update --write` turns it into an override
//         with runs_at, and the model maps 0x0804F318 to 0x03000388; the build reaches the SHA-1.
//
// Expected interfaces, for the phase-6 lead to align (architecture §2.1, §3.4, §6.5, §6.7):
//   expect.json {"ramCopy": {"start": "0x…", "size": "0x…", "runAt": "0x…"}}
//   romlift analyze --update --write --json, romlift trace --json, romlift model --json   exit 0; model's
//   first line {"schema":"romlift/model-json@1","modules":[{"name","span":{"start","end"},"runAt"?},…]}
//   setup.sh honours $ROMLIFT_CLI and <name>.sha1 is in sha1sum format (as in g4.e2e-fixtures)
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface RamCopy {
  readonly start: string;
  readonly size: string | number;
  readonly runAt: string;
}

interface ModelHeader {
  readonly schema: string;
  readonly modules: readonly { readonly name: string; readonly span: { readonly start: number; readonly end: number }; readonly runAt?: number }[];
}

interface Case {
  readonly name: string;
  readonly rom: string;
  readonly start: number;
  readonly runAt: number;
  /** The end of the range when known in advance (the fixture); the trace decides it on Klonoa. */
  readonly end?: number;
  readonly traced: boolean;
}

const KLONOA = { start: 0x0804_f318, runAt: 0x0300_0388 } as const;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function num(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 16);
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

/** The (start, runs_at) of every [[overrides]] block of a romlift.toml. */
function overrides(toml: string): readonly { readonly start: number; readonly runsAt?: number }[] {
  return toml.split(/^\s*\[\[overrides\]\]\s*$/m).slice(1).flatMap((block) => {
    const body = block.split(/^\s*\[/m)[0] ?? '';
    const start = /^\s*start\s*=\s*(0x[0-9A-Fa-f]+)/m.exec(body)?.[1];
    const runsAt = /^\s*runs_at\s*=\s*(0x[0-9A-Fa-f]+)/m.exec(body)?.[1];
    if (start === undefined) return [];
    return [runsAt === undefined ? { start: Number.parseInt(start, 16) } : { start: Number.parseInt(start, 16), runsAt: Number.parseInt(runsAt, 16) }];
  });
}

async function check(cx: GateContext, cli: string, c: Case, dir: string, ramCopy: RamCopy | undefined): Promise<readonly string[]> {
  const env = { ROMLIFT_CLI: cli };
  await mkdir(dir, { recursive: true });
  await copyFile(c.rom, path.join(dir, 'baserom.gba'));
  await step(cx, 'init', cli, ['init', 'baserom.gba', '--json'], dir, env);
  const tomlPath = path.join(dir, 'romlift.toml');
  if (ramCopy !== undefined) {
    await appendFile(tomlPath, `\n[[overrides]]\nstart = ${hex(c.start)}\nsize = ${hex(num(ramCopy.size))}\nkind = "code"\nruns_at = ${hex(c.runAt)}\n`);
  }
  if (c.traced) await step(cx, 'trace', cli, ['trace', '--json'], dir, env);
  await step(cx, 'analyze --update --write', cli, ['analyze', '--update', '--write', '--json'], dir, env);
  const problems: string[] = [];
  const listed = overrides(await readFile(tomlPath, 'utf8')).find((o) => o.start === c.start);
  if (listed?.runsAt !== c.runAt) problems.push(`romlift.toml has no override at ${hex(c.start)} with runs_at ${hex(c.runAt)}`);
  await step(cx, 'generate', cli, ['generate', '--json'], dir, env);
  const model = await step(cx, 'model', cli, ['model', '--json'], dir, env);
  const header = JSON.parse(model.stdout.split('\n')[0] ?? '{}') as ModelHeader;
  const module = header.modules.find((m) => m.span.start === c.start);
  if (module === undefined) problems.push(`no module starts at ${hex(c.start)}`);
  else {
    if (module.runAt !== c.runAt) problems.push(`module ${module.name} runs at ${module.runAt === undefined ? 'its load address' : hex(module.runAt)}, expected ${hex(c.runAt)}`);
    if (c.end !== undefined && module.span.end !== c.end) problems.push(`module ${module.name} ends at ${hex(module.span.end)}, the range at ${hex(c.end)}`);
    const ldscript = await readFile(path.join(dir, 'ldscript.txt'), 'utf8');
    const placed = ldscript.split('\n').some((l) => l.includes(`.${module.name}`) && /AT\s*\(/.test(l) && l.toLowerCase().includes(c.runAt.toString(16)));
    if (!placed) problems.push(`ldscript.txt does not place .${module.name} at ${hex(c.runAt)} with AT(...)`);
    if (!ldscript.includes(`__load_${module.name}`)) problems.push(`ldscript.txt does not define __load_${module.name}`);
  }
  await step(cx, './setup.sh', './setup.sh', [], dir, env);
  await step(cx, 'make', 'make', [], dir, env);
  const sha1Name = (await readdir(dir)).find((n) => n.endsWith('.sha1'));
  const match = sha1Name === undefined ? null : /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, sha1Name), 'utf8'));
  const built = match?.[2] === undefined ? undefined : path.join(dir, match[2]);
  const actual = built !== undefined && (await exists(built)) ? createHash('sha1').update(await readFile(built)).digest('hex') : 'nothing';
  const expected = createHash('sha1').update(await readFile(c.rom)).digest('hex');
  if (actual !== expected) problems.push(`make built ${actual}, expected ${expected}`);
  return problems;
}

gate({
  id: 'g6.ram-code-mapped',
  phase: 6,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['parseTrace', 'runTrace', 'analyzeUpdate', 'buildModel'],
  async run(cx) {
    const cli = await sourceCli(cx);
    const base = await cx.tmpDir('romlift-ram-code-');
    const problems: string[] = [];
    let fixtures = 0;
    for (const fixture of cx.fixtures) {
      const expect = (await exists(fixture.expect)) ? (JSON.parse(await readFile(fixture.expect, 'utf8')) as { readonly ramCopy?: RamCopy }) : {};
      const ramCopy = expect.ramCopy;
      if (ramCopy === undefined) continue;
      fixtures++;
      const start = num(ramCopy.start);
      const c: Case = { name: fixture.name, rom: fixture.rom, start, runAt: num(ramCopy.runAt), end: start + num(ramCopy.size), traced: false };
      for (const p of await check(cx, cli, c, path.join(base, fixture.name), ramCopy)) problems.push(`${fixture.name}: ${p}`);
    }
    if (fixtures === 0) problems.push('no committed fixture declares ramCopy in its expect.json');
    if (cx.tier === 'real') {
      const klonoa = cx.datasets.find((d) => d.name === 'klonoa');
      if (klonoa === undefined) throw new Error('no klonoa dataset');
      const c: Case = { name: 'klonoa', rom: path.resolve(cx.benchRoot, klonoa.rom), start: KLONOA.start, runAt: KLONOA.runAt, traced: true };
      for (const p of await check(cx, cli, c, path.join(base, 'klonoa'), undefined)) problems.push(`klonoa: ${p}`);
    }
    if (problems.length > 0) throw new Error(`code run from RAM: ${problems.join(' | ')}`);
    cx.note(`${fixtures} RAM-copy fixtures${cx.tier === 'real' ? ` and Klonoa (${hex(KLONOA.start)} -> ${hex(KLONOA.runAt)})` : ''} link at their run address and rebuild the ROM`);
  },
});
