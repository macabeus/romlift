// g6.expected-bytes (architecture §6.3 `expected`, §6.6, §13; g5.expected-bytes until the owner skipped phase 5 and
// moved the expected/ and objdiff.json writers into phase 6, D92): every expected/<module>.s is judged by the ROM,
// never by another project's expected/ output. In a project `init` wrote, every `c` module of the model
// has an expected/<module>.s; `make expected` assembles each into expected/<module>.o; the .text of each
// object must equal the ROM range of its module byte for byte, and on a mismatch the symbols that cover the
// first differing offsets are named. The ci tier runs every committed fixture; the real tier adds the six
// tuning ROMs (D60).
//
// Fix round 2 (correctness-r1-1, a tightening): since fix round 1 `make expected` writes the ROM range over the
// target's .text (D95 a), so that comparison alone can only catch a wrong size. The gate therefore also judges the
// unit's own object, build/expected/<module>.o (expected/<module>.s as assembled, before the ROM is written over it):
// its .text must equal the ROM range at every byte outside a relocated field (a relocated field holds the REL addend,
// which the link resolves), and every symbol it defines that the model places (a chunk's name, a function's entry, an
// inner label) must sit at the model's offset in the module. Two chunk files swapped in expected/<module>.s fail both.
//
// Expected interfaces, aligned by the phase-6 lead (architecture §2.1, §3.4, §6.3, D93; the `expected` writer is
// p6-c-data-expected's):
//   romlift init baserom.gba --json      exit 0
//   romlift model --json                 the first line is the header {"schema":"romlift/model-json@1",
//     "modules":[{"name":string,"kind":"asm"|"c"|"data","span":{"start":number,"end":number}},…],…}
//   make expected                        assembles expected/<module>.s into expected/<module>.o (no agbcc); the
//     scaffold's Makefile target, written with the writer; since fix round 2 it keeps the object as assembled at
//     build/expected/<module>.o
//   model --json chunk lines             {"name","module","span":{"start","end"},"entry"?,"innerLabels":[{"addr","name"}]}
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface ModelHeader {
  readonly schema: string;
  readonly modules: readonly { readonly name: string; readonly kind: string; readonly span: { readonly start: number; readonly end: number } }[];
}

interface ChunkLine {
  readonly name?: string;
  readonly module?: string;
  readonly span?: { readonly start: number | string; readonly end: number | string };
  readonly entry?: number | string;
  readonly runAt?: number | string;
  readonly innerLabels?: readonly { readonly addr: number | string; readonly name: string }[];
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

const ROM_BASE = 0x0800_0000;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** A model --json address: a number, or the "0x…" string romlift/model-json@1 prints. */
function num(v: number | string): number {
  return typeof v === 'number' ? v : Number.parseInt(v, 16);
}

/**
 * The bytes each ARM relocation type covers in .text (its field), from the ARM ELF ABI; a type the gate does not know
 * fails the gate rather than being guessed.
 */
const RELOC_WIDTH: Readonly<Record<string, number>> = {
  R_ARM_NONE: 0,
  R_ARM_V4BX: 0,
  R_ARM_ABS32: 4,
  R_ARM_REL32: 4,
  R_ARM_TARGET1: 4,
  R_ARM_PC24: 4,
  R_ARM_CALL: 4,
  R_ARM_JUMP24: 4,
  R_ARM_PLT32: 4,
  R_ARM_ABS16: 2,
  R_ARM_ABS8: 1,
  R_ARM_THM_CALL: 4,
  R_ARM_THM_PC22: 4,
  R_ARM_THM_JUMP24: 4,
  R_ARM_THM_JUMP11: 2,
  R_ARM_THM_JUMP8: 2,
  R_ARM_THM_JUMP6: 2,
  R_ARM_THM_PC8: 2,
  R_ARM_THM_ABS5: 2,
};

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

/** The fields of .text that relocations cover, from `readelf -rW`: a set of byte offsets, or the unknown types. */
async function relocatedBytes(cx: GateContext, object: string, cwd: string): Promise<{ readonly bytes: ReadonlySet<number>; readonly unknown: readonly string[] }> {
  const run = await step(cx, `readelf -r ${object}`, 'arm-none-eabi-readelf', ['-rW', object], cwd);
  const bytes = new Set<number>();
  const unknown: string[] = [];
  let inText = false;
  for (const line of run.stdout.split('\n')) {
    const section = /^Relocation section '([^']+)'/.exec(line);
    if (section !== null) {
      inText = section[1] === '.rel.text' || section[1] === '.rela.text';
      continue;
    }
    const row = /^([0-9a-f]{8})\s+[0-9a-f]{8}\s+(R_ARM_\w+)/.exec(line);
    if (!inText || row === null) continue;
    const offset = Number.parseInt(row[1] ?? '', 16);
    const width = RELOC_WIDTH[row[2] ?? ''];
    if (width === undefined) {
      unknown.push(`${row[2] ?? '?'} at .text+0x${offset.toString(16)}`);
      continue;
    }
    for (let k = 0; k < width; k++) bytes.add(offset + k);
  }
  return { bytes, unknown };
}

/** The symbols an object defines in .text by name, from `nm`, the Thumb bit cleared. */
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

/** Where the model places each name of module `module`: its chunks' names (at the entry or the start) and inner labels. */
function placedNames(chunks: readonly ChunkLine[], module: string): { readonly names: ReadonlyMap<string, number>; readonly runsAt: boolean } {
  const names = new Map<string, number>();
  let runsAt = false;
  for (const c of chunks) {
    if (c.module !== module || c.span === undefined) continue;
    if (c.runAt !== undefined) runsAt = true;
    if (c.name !== undefined) names.set(c.name, num(c.entry ?? c.span.start));
    for (const l of c.innerLabels ?? []) names.set(l.name, num(l.addr));
  }
  return { names, runsAt };
}

/**
 * The problems of the unit's own object, build/expected/<module>.o (see the header): its .text against the ROM range
 * outside the relocated fields, and its symbols against the model's places.
 */
async function checkUnitObject(cx: GateContext, name: string, module: ModelHeader['modules'][number], chunks: readonly ChunkLine[], want: Uint8Array, dir: string): Promise<readonly string[]> {
  const unit = path.join('build', 'expected', `${name}.o`);
  if (!(await exists(path.join(dir, unit)))) return [`make expected left no ${unit}, the unit's object as assembled`];
  const bin = path.join('build', 'expected', `${name}.text.bin`);
  await step(cx, `objcopy ${unit}`, 'arm-none-eabi-objcopy', ['-O', 'binary', '-j', '.text', unit, bin], dir);
  const bytes = new Uint8Array(await readFile(path.join(dir, bin)));
  const problems: string[] = [];
  if (bytes.length !== want.length) problems.push(`${name}: ${unit}'s .text is ${bytes.length} bytes, the module spans ${want.length}`);
  const relocated = await relocatedBytes(cx, unit, dir);
  if (relocated.unknown.length > 0) problems.push(`${name}: ${unit} has relocations of a type the gate does not know: ${relocated.unknown.slice(0, 4).join(', ')}`);
  const first = want.findIndex((b, i) => bytes[i] !== b && !relocated.bytes.has(i));
  const base = num(module.span.start);
  if (first >= 0) problems.push(`${name}: ${unit} differs from the ROM at ${hex(base + first)}, outside every relocated field (${(await covering(cx, unit, first, dir)).join(', ') || 'no symbol'})`);
  const placed = placedNames(chunks, name);
  if (placed.runsAt) return problems;
  for (const [symbol, offset] of await definedSymbols(cx, unit, dir)) {
    const at = placed.names.get(symbol);
    if (at !== undefined && at - base !== offset) {
      problems.push(`${name}: ${symbol} sits at ${hex(base + offset)} in ${unit}, where the model places it at ${hex(at)}`);
      if (problems.length >= 8) break;
    }
  }
  return problems;
}

async function checkTarget(cx: GateContext, target: Target, dir: string): Promise<{ readonly problems: readonly string[]; readonly modules: number }> {
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await mkdir(dir, { recursive: true });
  await copyFile(target.rom, path.join(dir, 'baserom.gba'));
  await step(cx, 'init', process.execPath, ['--conditions=source', main, 'init', 'baserom.gba', '--json'], dir);
  const model = await step(cx, 'model --json', process.execPath, ['--conditions=source', main, 'model', '--json'], dir);
  const modelLines = model.stdout.split('\n');
  const header = JSON.parse(modelLines[0] ?? '{}') as ModelHeader;
  const chunks = modelLines.slice(1).flatMap((line): ChunkLine[] => {
    if (!line.startsWith('{')) return [];
    const parsed = JSON.parse(line) as ChunkLine & { readonly type?: string };
    return parsed.type === undefined && parsed.module !== undefined ? [parsed] : [];
  });
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
    problems.push(...(await checkUnitObject(cx, name, module, chunks, want, dir)));
  }
  return { problems, modules: sources.length };
}

gate({
  id: 'g6.expected-bytes',
  phase: 6,
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
    cx.note(`${modules} expected modules on ${targets.length} ROMs equal their ROM ranges byte for byte, and each unit's object as assembled equals them outside its relocated fields with every symbol where the model places it`);
  },
});
