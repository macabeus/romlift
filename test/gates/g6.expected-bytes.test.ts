// g6.expected-bytes (architecture §6.3 `expected`, §6.6, §6.7, §13; g5.expected-bytes until the owner skipped phase 5
// and moved the expected/ and objdiff.json writers into phase 6, D92): every expected/<module>.s is judged by the ROM,
// never by another project's expected/ output. In a project `init` wrote, every `c` module of the model has an
// expected/<module>.s, and `make expected` assembles each, as it is, into build/expected/<module>.o, objdiff's target.
// The gate links every target at its module's address (its run address, loaded at its load address, for a runs_at
// module) and judges the linked target: its bytes must equal the module's ROM range byte for byte, the symbols that
// cover the first differing offset named, and every symbol the object defines that the model places (a chunk's name,
// a function's entry, an inner label) must sit at the model's address. Two chunk files swapped in expected/<module>.s
// fail both. The ci tier runs every committed fixture, and each fixture whose expect.json has `ramCopy` a second time
// with that range written as a hand-written [[overrides]] entry with runs_at (as g6.ram-code-mapped writes it); the
// real tier adds the six tuning ROMs (D60).
//
// The owner's answers of 25 October 2026 (D101): Q12, option (b), "expected/<module>.o is the unit's assembly as it
// is, without the ROM's bytes written over .text, so objdiff shows 100% on every untouched function; g6.expected-bytes
// judges the target after relocation, linked at its module's address, against the ROM range, and keeps the
// symbol-offset check"; Q16, option (a), "g6.expected-bytes judges runs_at modules (each symbol at the model address
// minus the chunk's runAt, or the equivalent under Q12's linked judgment) and its targets include the RAM-copy fixture
// with its hand-written runs_at override, as g6.ram-code-mapped does". Linked, a runs_at symbol sits at its run
// address, which is the model's address of an inner label and the chunk's runAt plus the entry's offset for a chunk.
//
// Expected interfaces, aligned by the phase-6 lead (architecture §2.1, §3.4, §6.3, §6.7, D93, D101):
//   romlift init baserom.gba --json      exit 0
//   romlift analyze --update --write --json, romlift generate --json   exit 0 (the runs_at targets, after the
//     [[overrides]] entry is appended to romlift.toml)
//   romlift model --json                 the first line is the header {"schema":"romlift/model-json@1",
//     "modules":[{"name":string,"kind":"asm"|"c"|"data","span":{"start","end"},"runAt"?},…],…}
//   model --json chunk lines             {"name","module","span":{"start","end"},"entry"?,"runAt"?,"innerLabels":[{"addr","name"}]}
//   make expected                        assembles expected/<module>.s into build/expected/<module>.o (no agbcc), the
//     scaffold's Makefile target, written with the writer
//   symbols.ld                           the project's RAM and absolute symbols, a linker script fragment
//   __load_<module>                      the load address of a runs_at module, which its own code may name (§6.7)
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

type Address = number | string;

interface ModelModule {
  readonly name: string;
  readonly kind: string;
  readonly span: { readonly start: Address; readonly end: Address };
  readonly runAt?: Address;
}

interface ModelHeader {
  readonly schema: string;
  readonly modules: readonly ModelModule[];
}

interface ChunkLine {
  readonly name?: string;
  readonly module?: string;
  readonly span?: { readonly start: Address; readonly end: Address };
  readonly entry?: Address;
  readonly runAt?: Address;
  readonly innerLabels?: readonly { readonly addr: Address; readonly name: string }[];
}

/** A hand-written [[overrides]] entry with runs_at, from a fixture's expect.json `ramCopy`. */
interface RamOverride {
  readonly start: number;
  readonly size: number;
  readonly runAt: number;
  readonly mode?: 'thumb' | 'arm';
}

interface Target {
  readonly name: string;
  readonly rom: string;
  readonly override?: RamOverride;
}

/** A module the gate links: its name, ROM range, the address its target links at, and its object. */
interface Placed {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly vma: number;
  readonly runsAt: boolean;
  readonly object: string;
}

const ROM_BASE = 0x0800_0000;
const JUDGE_SCRIPT = path.join('build', 'expected', 'judge.ld');
const JUDGE_ELF = path.join('build', 'expected', 'judge.elf');
const MAX_SYMBOL_PROBLEMS = 8;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** A model --json or expect.json address: a number, or a "0x…" string. */
function num(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^0x[0-9A-Fa-f]+$/.test(v)) return Number.parseInt(v.slice(2), 16);
  throw new Error(`${what} is not an address (${JSON.stringify(v)})`);
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

/** The fixture's `ramCopy` as an override, or undefined when its expect.json has none. */
async function ramCopyOf(expect: string): Promise<RamOverride | undefined> {
  if (!(await exists(expect))) return undefined;
  const ramCopy = (JSON.parse(await readFile(expect, 'utf8')) as { readonly ramCopy?: Readonly<Record<string, unknown>> }).ramCopy;
  if (ramCopy === undefined) return undefined;
  const mode = ramCopy['mode'];
  if (mode !== undefined && mode !== 'thumb' && mode !== 'arm') throw new Error(`${expect} ramCopy.mode is not 'thumb' or 'arm'`);
  const base = { start: num(ramCopy['start'], `${expect} ramCopy.start`), size: num(ramCopy['size'], `${expect} ramCopy.size`), runAt: num(ramCopy['runAt'], `${expect} ramCopy.runAt`) };
  return mode === undefined ? base : { ...base, mode };
}

function overrideBlock(o: RamOverride): string {
  return `\n[[overrides]]\nstart = ${hex(o.start)}\nsize = 0x${o.size.toString(16).toUpperCase()}\nkind = "code"\n${o.mode === undefined ? '' : `mode = "${o.mode}"\n`}runs_at = ${hex(o.runAt)}\n`;
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

/** The symbols an object defines in .text by name, at their offsets from `nm`, the Thumb bit cleared. */
async function definedSymbols(cx: GateContext, object: string, cwd: string): Promise<ReadonlyMap<string, number>> {
  const nm = await step(cx, `nm ${object}`, 'arm-none-eabi-nm', ['--defined-only', object], cwd);
  const out = new Map<string, number>();
  for (const line of nm.stdout.split('\n')) {
    const [value, type, name] = line.trim().split(/\s+/);
    if (value === undefined || name === undefined || type === undefined || !/^[tT]$/.test(type)) continue;
    out.set(name, Number.parseInt(value, 16) & ~1);
  }
  return out;
}

/**
 * Where the model places each name of module `module`, at its run address (its load address outside runs_at): a chunk's
 * name at its entry (or start) moved by the chunk's runAt, an inner label at its own address, which the model already
 * gives as the run address.
 */
function placedNames(chunks: readonly ChunkLine[], module: string): ReadonlyMap<string, number> {
  const names = new Map<string, number>();
  for (const c of chunks) {
    if (c.module !== module || c.span === undefined) continue;
    const start = num(c.span.start, `chunk ${c.name ?? '?'} span.start`);
    const runOffset = c.runAt === undefined ? 0 : num(c.runAt, `chunk ${c.name ?? '?'} runAt`) - start;
    if (c.name !== undefined) names.set(c.name, num(c.entry ?? c.span.start, `chunk ${c.name} entry`) + runOffset);
    for (const l of c.innerLabels ?? []) names.set(l.name, num(l.addr, `label ${l.name}`));
  }
  return names;
}

/** The output section of the i-th placed module in the gate's linker script. */
function sectionOf(i: number): string {
  return `.expected_${i}`;
}

/**
 * The gate's linker script: every target at its module's address, a runs_at one at its run address loaded at its load
 * address with its __load_<module>, and the project's symbols.ld for the RAM and absolute symbols.
 */
function judgeScript(placed: readonly Placed[], symbols: boolean): string {
  const lines = ["/* g6.expected-bytes: each objdiff target linked at its module's address. */"];
  if (symbols) lines.push('INCLUDE symbols.ld');
  lines.push('SECTIONS {');
  placed.forEach((p, i) => {
    lines.push(`    ${sectionOf(i)} ${hex(p.vma)} : AT(${hex(p.start)}) { ${p.object}(.text) }`);
    if (p.runsAt) lines.push(`    __load_${p.name} = LOADADDR(${sectionOf(i)});`);
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** The problems of one linked target: its bytes against the ROM range, and its symbols against the model's places. */
async function checkLinked(cx: GateContext, p: Placed, i: number, chunks: readonly ChunkLine[], rom: Uint8Array, dir: string): Promise<readonly string[]> {
  const bin = path.join('build', 'expected', `${p.name}.linked.bin`);
  await step(cx, `objcopy ${sectionOf(i)}`, 'arm-none-eabi-objcopy', ['-O', 'binary', '-j', sectionOf(i), JUDGE_ELF, bin], dir);
  const bytes = new Uint8Array(await readFile(path.join(dir, bin)));
  const want = rom.subarray(p.start - ROM_BASE, p.end - ROM_BASE);
  const problems: string[] = [];
  if (bytes.length !== want.length) problems.push(`${p.name}: ${p.object} links to ${bytes.length} bytes, the module spans ${want.length}`);
  const first = want.findIndex((b, k) => bytes[k] !== b);
  if (first >= 0) problems.push(`${p.name}: ${p.object} linked at ${hex(p.vma)} differs from the ROM at ${hex(p.start + first)} (${(await covering(cx, p.object, first, dir)).join(', ') || 'no symbol'})`);
  const placed = placedNames(chunks, p.name);
  let misplaced = 0;
  for (const [symbol, offset] of await definedSymbols(cx, p.object, dir)) {
    const at = placed.get(symbol);
    if (at === undefined || p.vma + offset === at) continue;
    problems.push(`${p.name}: ${symbol} links at ${hex(p.vma + offset)}, where the model places it at ${hex(at)}`);
    if (++misplaced >= MAX_SYMBOL_PROBLEMS) break;
  }
  return problems;
}

async function checkTarget(cx: GateContext, target: Target, dir: string): Promise<{ readonly problems: readonly string[]; readonly modules: number; readonly runsAt: number }> {
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const cli = (what: string, ...args: string[]): Promise<ExecResult> => step(cx, what, process.execPath, ['--conditions=source', main, ...args], dir);
  await mkdir(dir, { recursive: true });
  await copyFile(target.rom, path.join(dir, 'baserom.gba'));
  await cli('init', 'init', 'baserom.gba', '--json');
  if (target.override !== undefined) {
    await appendFile(path.join(dir, 'romlift.toml'), overrideBlock(target.override));
    await cli('analyze --update --write', 'analyze', '--update', '--write', '--json');
    await cli('generate', 'generate', '--json');
  }
  const model = await cli('model --json', 'model', '--json');
  const modelLines = model.stdout.split('\n');
  const header = JSON.parse(modelLines[0] ?? '{}') as ModelHeader;
  if (header.schema !== 'romlift/model-json@1') throw new Error(`model --json printed schema ${String(header.schema)} first`);
  const chunks = modelLines.slice(1).flatMap((line): ChunkLine[] => {
    if (!line.startsWith('{')) return [];
    const parsed = JSON.parse(line) as ChunkLine & { readonly type?: string };
    return parsed.type === undefined && parsed.module !== undefined ? [parsed] : [];
  });
  const sources = (await readdir(path.join(dir, 'expected')).catch(() => [] as string[])).filter((n) => n.endsWith('.s')).map((n) => n.slice(0, -2));
  const problems: string[] = [];
  for (const m of header.modules) if (m.kind === 'c' && !sources.includes(m.name)) problems.push(`no expected/${m.name}.s for C module ${m.name}`);
  if (sources.length === 0) return { problems: [...problems, 'expected/ holds no module'], modules: 0, runsAt: 0 };
  const override = target.override;
  if (override !== undefined && !header.modules.some((m) => m.runAt !== undefined && num(m.span.start, `module ${m.name} span.start`) === override.start)) {
    problems.push(`no runs_at module starts at ${hex(override.start)}, the override's range`);
  }
  await step(cx, 'make expected', 'make', ['expected'], dir);

  const placed: Placed[] = [];
  for (const name of sources.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const module = header.modules.find((m) => m.name === name);
    if (module === undefined) {
      problems.push(`expected/${name}.s names no module of the model`);
      continue;
    }
    const object = path.join('build', 'expected', `${name}.o`);
    if (!(await exists(path.join(dir, object)))) {
      problems.push(`make expected built no ${object}`);
      continue;
    }
    const start = num(module.span.start, `module ${name} span.start`);
    const runAt = module.runAt === undefined ? undefined : num(module.runAt, `module ${name} runAt`);
    placed.push({ name, start, end: num(module.span.end, `module ${name} span.end`), vma: runAt ?? start, runsAt: runAt !== undefined, object });
  }
  await writeFile(path.join(dir, JUDGE_SCRIPT), judgeScript(placed, await exists(path.join(dir, 'symbols.ld'))));
  const link = await cx.exec('arm-none-eabi-ld', ['-T', JUDGE_SCRIPT, '-o', JUDGE_ELF, ...placed.map((p) => p.object)], { cwd: dir });
  if (link.code !== 0) return { problems: [...problems, `the targets do not link at their modules' addresses (ld exited ${link.code}): ${tail(link, 8)}`], modules: sources.length, runsAt: 0 };
  const rom = new Uint8Array(await readFile(target.rom));
  for (const [i, p] of placed.entries()) problems.push(...(await checkLinked(cx, p, i, chunks, rom, dir)));
  return { problems, modules: sources.length, runsAt: placed.filter((p) => p.runsAt).length };
}

gate({
  id: 'g6.expected-bytes',
  phase: 6,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['init', 'generate', 'emitTree', 'analyzeUpdate'],
  async run(cx) {
    const targets: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    for (const fixture of cx.fixtures) {
      const override = await ramCopyOf(fixture.expect);
      if (override !== undefined) targets.push({ name: `${fixture.name}+runs_at`, rom: fixture.rom, override });
    }
    if (!targets.some((t) => t.override !== undefined)) throw new Error('no committed fixture declares ramCopy in its expect.json');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });
    const base = await cx.tmpDir('romlift-expected-');
    const problems: string[] = [];
    let modules = 0;
    let runsAt = 0;
    for (const target of targets) {
      const result = await checkTarget(cx, target, path.join(base, target.name));
      modules += result.modules;
      runsAt += result.runsAt;
      for (const p of result.problems) problems.push(`${target.name}: ${p}`);
    }
    if (problems.length > 0) throw new Error(`expected/ against the ROM: ${problems.join(' | ')}`);
    cx.note(`${modules} expected modules on ${targets.length} targets (${runsAt} runs_at), each linked at its module's address, equal their ROM ranges byte for byte with every symbol where the model places it`);
  },
});
