// g5.expected-bytes (architecture §6.3 `expected`, §6.8, §13): every expected/<module>.s is judged by the
// ROM, never by another project's expected/ output. In a project `init` wrote, every `c` module of the model
// has an expected/<module>.s; `make expected` assembles each into expected/<module>.o; the .text of each
// object must equal the ROM range of its module byte for byte, and on a mismatch the symbols that cover the
// first differing offsets are named. The ci tier runs every committed fixture; the real tier adds the five
// tuning ROMs.
//
// Expected interfaces, for the phase-5 lead to align (architecture §2.1, §3.4, §6.3):
//   romlift init baserom.gba --json      exit 0
//   romlift model --json                 the first line is the header {"schema":"romlift/model-json@1",
//     "modules":[{"name":string,"kind":"asm"|"c"|"data","span":{"start":number,"end":number}},…],…}
//   make expected                        assembles expected/<module>.s into expected/<module>.o (no agbcc)
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface ModelHeader {
  readonly schema: string;
  readonly modules: readonly { readonly name: string; readonly kind: string; readonly span: { readonly start: number; readonly end: number } }[];
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

const ROM_BASE = 0x0800_0000;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function step(cx: GateContext, what: string, command: string, args: readonly string[], cwd: string): Promise<ExecResult> {
  const run = await cx.exec(command, args, { cwd });
  if (run.code !== 0) throw new Error(`${what} exited ${run.code}:\n${tail(run)}`);
  return run;
}

/** The symbols of an object whose [value, value + size) covers `offset`, from `nm -S`. */
async function covering(cx: GateContext, object: string, offset: number, cwd: string): Promise<readonly string[]> {
  const nm = await cx.exec('arm-none-eabi-nm', ['--defined-only', '-S', object], { cwd });
  return nm.stdout.split('\n').flatMap((line) => {
    const [value, size, , name] = line.trim().split(/\s+/);
    if (value === undefined || size === undefined || name === undefined) return [];
    const start = Number.parseInt(value, 16);
    return start <= offset && offset < start + Number.parseInt(size, 16) ? [name] : [];
  });
}

async function checkTarget(cx: GateContext, target: Target, dir: string): Promise<{ readonly problems: readonly string[]; readonly modules: number }> {
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await mkdir(dir, { recursive: true });
  await copyFile(target.rom, path.join(dir, 'baserom.gba'));
  await step(cx, 'init', process.execPath, ['--conditions=source', main, 'init', 'baserom.gba', '--json'], dir);
  const model = await step(cx, 'model --json', process.execPath, ['--conditions=source', main, 'model', '--json'], dir);
  const header = JSON.parse(model.stdout.split('\n')[0] ?? '{}') as ModelHeader;
  if (header.schema !== 'romlift/model-json@1') throw new Error(`model --json printed schema ${String(header.schema)} first`);
  const expectedDir = path.join(dir, 'expected');
  const sources = (await readdir(expectedDir).catch(() => [] as string[])).filter((n) => n.endsWith('.s')).map((n) => n.slice(0, -2));
  const problems: string[] = [];
  for (const m of header.modules) if (m.kind === 'c' && !sources.includes(m.name)) problems.push(`no expected/${m.name}.s for C module ${m.name}`);
  if (sources.length === 0) return { problems: [...problems, 'expected/ holds no module'], modules: 0 };
  await step(cx, 'make expected', 'make', ['expected'], dir);
  const rom = new Uint8Array(await readFile(target.rom));
  for (const name of sources.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const module = header.modules.find((m) => m.name === name);
    if (module === undefined) {
      problems.push(`expected/${name}.s names no module of the model`);
      continue;
    }
    const object = path.join('expected', `${name}.o`);
    if (!(await exists(path.join(dir, object)))) {
      problems.push(`make expected built no ${object}`);
      continue;
    }
    const bin = path.join('expected', `${name}.text.bin`);
    await step(cx, `objcopy ${object}`, 'arm-none-eabi-objcopy', ['-O', 'binary', '-j', '.text', object, bin], dir);
    const bytes = new Uint8Array(await readFile(path.join(dir, bin)));
    const want = rom.subarray(module.span.start - ROM_BASE, module.span.end - ROM_BASE);
    if (bytes.length !== want.length) problems.push(`${name}: .text is ${bytes.length} bytes, the module spans ${want.length}`);
    const first = want.findIndex((b, i) => bytes[i] !== b);
    if (first >= 0) problems.push(`${name}: differs from the ROM at ${hex(module.span.start + first)} (${(await covering(cx, object, first, dir)).join(', ') || 'no symbol'})`);
  }
  return { problems, modules: sources.length };
}

gate({
  id: 'g5.expected-bytes',
  phase: 5,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['init', 'generate', 'emitTree'],
  async run(cx) {
    const targets: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });
    const base = await cx.tmpDir('romlift-expected-');
    const problems: string[] = [];
    let modules = 0;
    for (const target of targets) {
      const result = await checkTarget(cx, target, path.join(base, target.name));
      modules += result.modules;
      for (const p of result.problems) problems.push(`${target.name}: ${p}`);
    }
    if (problems.length > 0) throw new Error(`expected/ against the ROM: ${problems.join(' | ')}`);
    cx.note(`${modules} expected modules on ${targets.length} ROMs equal their ROM ranges byte for byte`);
  },
});
