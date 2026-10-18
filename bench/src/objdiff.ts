// The objdiff family (architecture §8.4 "objdiff", D34): on a tuning ROM whose readable build links, every
// function whose entry and extent agree with the ELF (score.ts agreeingFunctions) is compared by objdiff-cli
// (objdiff-cli.ts, the version of bench/tools/objdiff.version) with the reference project's own object that
// defines it (objects.ts). The base is that function's emitted `.s`, the function writer's text under the
// dialect preamble, from the model of the seedless discover run's config with the ELF's names put in by
// address (namedConfig), assembled alone with romlift's assembleWithBinutils; the functions of one reference
// object are joined by `ld -r` so objdiff-cli runs once per reference object.
//
// Each difference has a kind; `unnamed-target` (a relocation whose reference side targets a section symbol)
// is reported and not gated, every other kind fails g3.objdiff:
//   instruction         a row whose instruction differs
//   resolved-call       a `bl` the reference's assembler resolved inside its object, which the base, holding one
//                       function, relocates against the same callee (the same call, counted apart)
//   relocation          a relocation whose targets differ, or that only the base carries
//   missing-relocation  the reference relocates to a named symbol where the base holds a plain value
//   missing-symbol      no reference object defines the name, or objdiff paired nothing with it
//   score               objdiff paired it with no differing row and scored it below 100%
//   assemble            the base did not assemble
//   tool                objdiff-cli failed on the pair
// objdiffVerdict is pure; scoreObjdiff runs the tools.
import { availableParallelism, tmpdir } from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildModel,
  compareCodeUnits,
  configFromDiscover,
  contains,
  parseElf,
  printChunk,
  type AnalysisResult,
  type ElfSymbol,
  type FunctionConfig,
  type Model,
  type Rom,
  type RomliftConfig,
  type SymbolConfig,
} from 'romlift';
import { DIALECT } from 'romlift/isa';
import { assembleWithBinutils, findBinutils, type Binutils } from 'romlift/node';

import { diffObjects, type FunctionDiff } from './objdiff-cli.ts';
import { indexObjectSymbols, listObjectFiles, objectFor, readObjectSymbolIndex, type ObjectSymbolIndex, type ObjectSymbols } from './objects.ts';
import { runProcess } from './process.ts';
import { agreeingFunctions } from './score.ts';
import type { Truth } from './truth.ts';

/** The one kind that is reported and not gated (D34). */
export const REPORTED_ONLY = 'unnamed-target';

/** The examples kept per kind. */
export const EXAMPLES_PER_KIND = 5;

export interface ObjdiffExample {
  readonly function: string;
  readonly kind: string;
  readonly detail: string;
}

/** A tuning row's `objdiff` member (frozen by test/gates/g3.objdiff.test.ts). */
export interface ObjdiffSummary {
  /** The readable build reproduced the SHA-1. */
  readonly linked: boolean;
  /** The functions compared: those whose entry and extent agree with the ELF. */
  readonly scored: number;
  /** Per kind, the number of differences, kinds in code-unit order. */
  readonly differences: Readonly<Record<string, number>>;
  /** Up to EXAMPLES_PER_KIND per kind, by kind, then function, then detail. */
  readonly examples: readonly ObjdiffExample[];
}

/** One compared function: objdiff's result for it, or why there is none. */
export type ComparedFunction =
  | {
      readonly name: string;
      readonly diff: FunctionDiff | undefined;
      /** The reference object's function offsets by name, which tell a call `as` resolved inside it (resolvedCall). */
      readonly referenceFunctions?: ReadonlyMap<string, number>;
    }
  | { readonly name: string; readonly failure: { readonly kind: 'missing-symbol' | 'assemble' | 'tool'; readonly detail: string } };

const RESOLVED_BL = /^bl 0x([0-9a-f]+)$/;
const RELOCATED_BL = /^bl ([A-Za-z_.$][A-Za-z0-9_.$]*)-0x4$/;

/**
 * The callee when a differing row is one call spelled two ways: the reference's `bl <offset>`, which `as`
 * resolved because the callee lies in the same object, and the base's `bl <name>-0x4`, a relocation against
 * that callee because the base holds one function, where the reference object defines <name> at <offset>.
 */
export function resolvedCall(kind: string, reference: string | null, base: string | null, functions: ReadonlyMap<string, number> | undefined): string | undefined {
  if (kind !== 'arg-mismatch' || functions === undefined) return undefined;
  const target = RESOLVED_BL.exec(reference ?? '')?.[1];
  const callee = RELOCATED_BL.exec(base ?? '')?.[1];
  if (target === undefined || callee === undefined) return undefined;
  return functions.get(callee) === Number.parseInt(target, 16) ? callee : undefined;
}

const offsetText = (offset: number | null): string => (offset === null ? 'base only' : `+0x${offset.toString(16)}`);

/** The differences of one function, each with its kind. */
export function functionDifferences(compared: ComparedFunction): ObjdiffExample[] {
  const name = compared.name;
  if ('failure' in compared) return [{ function: name, kind: compared.failure.kind, detail: compared.failure.detail }];
  const diff = compared.diff;
  if (diff === undefined) return [{ function: name, kind: 'missing-symbol', detail: 'the reference object lists no function of that name' }];
  if (!diff.paired) return [{ function: name, kind: 'missing-symbol', detail: 'objdiff paired no base symbol with it' }];
  const out: ObjdiffExample[] = [];
  for (const d of diff.instructionDifferences) {
    const callee = resolvedCall(d.kind, d.reference, d.base, compared.referenceFunctions);
    const detail = `${offsetText(d.offset)} ${d.kind}: ${d.reference ?? '(none)'} | ${d.base ?? '(none)'}`;
    out.push(callee === undefined ? { function: name, kind: 'instruction', detail } : { function: name, kind: 'resolved-call', detail: `${detail} (${callee} is at that offset of the reference object)` });
  }
  for (const r of diff.relocationDifferences) {
    const where = `${offsetText(r.offset)} ${r.type}`;
    if (r.reference?.symbol === 'section') out.push({ function: name, kind: REPORTED_ONLY, detail: `${where}: section ${r.reference.name} | ${r.base ?? 'no relocation'}` });
    else if (r.reference !== null && r.base === null) out.push({ function: name, kind: 'missing-relocation', detail: `${where}: ${r.reference.name} | a plain value` });
    else out.push({ function: name, kind: 'relocation', detail: `${where}: ${r.reference?.name ?? 'no relocation'} | ${r.base ?? 'no relocation'}` });
  }
  if (out.length === 0 && diff.matchPercent !== 100) out.push({ function: name, kind: 'score', detail: `objdiff scored it ${String(diff.matchPercent)}% with no differing row` });
  return out;
}

const byExample = (a: ObjdiffExample, b: ObjdiffExample): number => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.function, b.function) || compareCodeUnits(a.detail, b.detail);

export interface ObjdiffVerdict {
  readonly scored: number;
  readonly differences: Readonly<Record<string, number>>;
  readonly examples: readonly ObjdiffExample[];
  /** No difference of a gated kind, and at least one function scored. */
  readonly pass: boolean;
}

/** The verdict over every compared function of a ROM; pure. */
export function objdiffVerdict(compared: readonly ComparedFunction[]): ObjdiffVerdict {
  const all = compared.flatMap(functionDifferences).sort(byExample);
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const differences: Record<string, number> = {};
  for (const kind of [...counts.keys()].sort(compareCodeUnits)) differences[kind] = counts.get(kind) ?? 0;
  const examples: ObjdiffExample[] = [];
  const shown = new Map<string, number>();
  for (const d of all) {
    const n = shown.get(d.kind) ?? 0;
    if (n >= EXAMPLES_PER_KIND) continue;
    shown.set(d.kind, n + 1);
    examples.push(d);
  }
  const gated = all.some((d) => d.kind !== REPORTED_ONLY);
  return { scored: compared.length, differences, examples, pass: compared.length > 0 && !gated };
}

/** The member of a ROM whose readable build does not link: nothing is scored (g3.objdiff notes it). */
export function unlinkedSummary(): ObjdiffSummary {
  return { linked: false, scored: 0, differences: {}, examples: [] };
}

export function linkedSummary(verdict: ObjdiffVerdict): ObjdiffSummary {
  return { linked: true, scored: verdict.scored, differences: verdict.differences, examples: verdict.examples };
}

// ---------------------------------------------------------------------------------------------------
// The base: the discover config with the ELF's names

/** What namedConfig gives an assembler symbol name (the config schema's rule). */
const SYMBOL_NAME = /^[A-Za-z_.$][A-Za-z0-9_.$]*$/;

/** Whether an ELF symbol names a function or a piece of data a label can carry. */
function isNameable(s: ElfSymbol): boolean {
  if (!SYMBOL_NAME.test(s.name) || s.name.startsWith('$') || s.name.startsWith('.L')) return false;
  return s.type === 'func' || s.type === 'object' || s.type === 'notype';
}

/** One name per address, a global or weak definition before a local one, then the first in the table. */
function namesByAddr(symbols: readonly ElfSymbol[], keep: (s: ElfSymbol) => boolean): Map<number, string> {
  const out = new Map<number, { readonly name: string; readonly global: boolean }>();
  for (const s of symbols) {
    if (!isNameable(s) || !keep(s)) continue;
    const global = s.bind !== 'local';
    const had = out.get(s.addr);
    if (had === undefined || (global && !had.global)) out.set(s.addr, { name: s.name, global });
  }
  return new Map([...out].map(([addr, v]) => [addr, v.name] as const));
}

/**
 * The discover config with the reference ELF's names by address (D34): each listed function takes the ELF
 * `FUNC` name at its entry, and every `OBJECT` or untyped symbol of the ROM outside every function's extent
 * becomes a symbol, so the data labels the code names carry the reference's names. A name the ELF uses at
 * two addresses (two static definitions) is given to neither, so the model keeps one name per label.
 */
export function namedConfig(config: RomliftConfig, rom: Rom, symbols: readonly ElfSymbol[], extents: readonly { readonly entry: number; readonly end: number }[]): RomliftConfig {
  const inside = (addr: number): boolean => extents.some((f) => addr >= f.entry && addr < f.end);
  const funcs = namesByAddr(symbols, (s) => s.type === 'func' && config.functions.has(s.addr));
  const data = namesByAddr(symbols, (s) => s.type !== 'func' && contains(rom, s.addr) && !config.functions.has(s.addr) && !inside(s.addr));
  const uses = new Map<string, number>();
  for (const name of [...funcs.values(), ...data.values()]) uses.set(name, (uses.get(name) ?? 0) + 1);
  const unique = (name: string): boolean => uses.get(name) === 1;
  const functions = new Map<number, FunctionConfig>();
  for (const [addr, f] of config.functions) {
    const name = funcs.get(addr);
    functions.set(addr, name !== undefined && unique(name) ? { ...f, name, aliases: [] } : f);
  }
  const named = new Map<number, SymbolConfig>(config.symbols);
  for (const [addr, name] of data) if (unique(name) && !named.has(addr)) named.set(addr, { name, aliases: [] });
  return { ...config, functions, symbols: named };
}

/** The base text of the function chunk at `chunk`: the dialect preamble, then the function writer's text. */
export function functionSource(rom: Rom, model: Model, chunk: number): string {
  const c = model.chunks[chunk];
  return `${DIALECT.preamble(c?.mode ?? 'thumb')}${printChunk(rom, model, chunk, 'readable').lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------
// Running the tools

export interface ObjdiffInputs {
  readonly rom: Rom;
  readonly analysis: AnalysisResult;
  readonly truth: Pick<Truth, 'byAddr'>;
  /** The reference ELF's symbols. */
  readonly symbols: readonly ElfSymbol[];
  /** The reference build's objects directory (absolute). */
  readonly objectsDir: string;
  /** The objdiff-cli binary. */
  readonly objdiff: string;
  /**
   * The objects (relative to objectsDir, `/`-separated) the reference map links; when given, only they define
   * names, so a stale object a build directory still holds cannot make a name ambiguous.
   */
  readonly linkedObjects?: ReadonlySet<string>;
  readonly tools?: Binutils;
  /** Parallel tool runs; default the machine's available parallelism. */
  readonly concurrency?: number;
}

/** Runs `work` over `items` with at most `limit` in flight; results in the order of `items`. */
export async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return out;
}

interface Job {
  /** Its position, which names its object. */
  readonly n: number;
  readonly name: string;
  readonly chunk: number | undefined;
  readonly object: string | undefined;
}

type Failure = Extract<ComparedFunction, { readonly failure: unknown }>;

/** Why a job is not compared at all: no reference object defines its name, or the model has no chunk at its entry. */
function unpairable(job: Job, index: ObjectSymbolIndex): Failure | undefined {
  if (job.object === undefined) {
    const defs = index.definitions.get(job.name) ?? [];
    const detail = defs.length === 0 ? 'no reference object defines it' : `it is defined ambiguously (${defs.map((d) => `${d.object} ${d.bind}`).join(', ')})`;
    return { name: job.name, failure: { kind: 'missing-symbol', detail } };
  }
  if (job.chunk === undefined) return { name: job.name, failure: { kind: 'missing-symbol', detail: 'the model has no function chunk at its entry' } };
  return undefined;
}

/** The functions of one reference object: each assembled alone, then all compared in one objdiff-cli run. */
interface Group {
  readonly object: string;
  readonly jobs: readonly Job[];
}

interface Context {
  readonly inputs: ObjdiffInputs;
  readonly model: Model;
  readonly tools: Binutils;
  readonly dir: string;
}

/** Assembles one function's base text alone; its object path, or the assembler's failure. */
async function assembleJob(job: Job, cx: Context): Promise<{ readonly path: string } | Failure> {
  const assembled = await assembleWithBinutils(functionSource(cx.inputs.rom, cx.model, job.chunk ?? 0), { files: { 'include/macros.inc': DIALECT.macrosInc }, tools: cx.tools });
  if (!assembled.ok) return { name: job.name, failure: { kind: 'assemble', detail: assemblerError(assembled.stderr) ?? assembled.diagnostics[0]?.message ?? 'as failed' } };
  const path = join(cx.dir, `${job.n}.o`);
  await writeFile(path, assembled.object);
  return { path };
}

/** One objdiff-cli run of the reference object against `base`, read for each job's function. */
async function diffJobs(cx: Context, object: string, base: string, jobs: readonly Job[]): Promise<ComparedFunction[]> {
  const diffed = await diffObjects(cx.inputs.objdiff, join(cx.inputs.objectsDir, object), base);
  if (!diffed.ok) return jobs.map((job) => ({ name: job.name, failure: { kind: 'tool' as const, detail: `${object}: ${toolError(diffed.error)}` } }));
  const referenceFunctions = new Map(diffed.value.functions.map((f) => [f.name, f.offset] as const));
  return jobs.map((job) => ({ name: job.name, diff: diffed.value.functions.find((f) => f.name === job.name), referenceFunctions }));
}

/**
 * The functions of one reference object. Each base is assembled alone, so its references to anything outside
 * the function stay relocations against named symbols; the objects are then joined by a relocatable link
 * (`ld -r`, which keeps every relocation) so objdiff-cli reads the reference object once. When the join
 * fails, each function is compared on its own.
 */
async function compareGroup(group: Group, cx: Context): Promise<ComparedFunction[]> {
  const out = new Map<number, ComparedFunction>();
  const assembled: { readonly job: Job; readonly path: string }[] = [];
  for (const job of group.jobs) {
    const result = await assembleJob(job, cx);
    if ('path' in result) assembled.push({ job, path: result.path });
    else out.set(job.n, result);
  }
  if (assembled.length > 0) {
    const merged = join(cx.dir, `${assembled[0]?.job.n ?? 0}-group.o`);
    const joined = assembled.length === 1 ? { code: 0 } : await runProcess(cx.tools.ld, ['-r', '-o', merged, ...assembled.map((a) => a.path)]);
    const base = assembled.length === 1 ? (assembled[0]?.path ?? merged) : merged;
    const compared =
      joined.code === 0
        ? await diffJobs(cx, group.object, base, assembled.map((a) => a.job))
        : (await Promise.all(assembled.map((a) => diffJobs(cx, group.object, a.path, [a.job])))).flat();
    compared.forEach((c, i) => {
      const job = assembled[i]?.job;
      if (job !== undefined) out.set(job.n, c);
    });
  }
  await Promise.all([...assembled.map((a) => rm(a.path, { force: true })), rm(join(cx.dir, `${assembled[0]?.job.n ?? 0}-group.o`), { force: true })]);
  return group.jobs.map((job) => out.get(job.n) ?? { name: job.name, failure: { kind: 'tool', detail: 'not compared' } });
}

/** The assembler's first error line (`source.s:12: Error: ...`), or its first line, or undefined when it printed nothing. */
export function assemblerError(stderr: string): string | undefined {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  return lines.find((l) => l.includes('Error:')) ?? lines[0];
}

/** objdiff-cli's complaint without the paths of the pair (the base's is a temporary file): what follows `Failed:`, else its first line. */
export function toolError(error: string): string {
  const failed = /Failed:\s*(.*)/.exec(error);
  return (failed?.[1] ?? error.split('\n')[0] ?? '').trim();
}

/** The names the objects under `dir` define, only the `linked` ones when given. */
export async function symbolIndex(dir: string, linked: ReadonlySet<string> | undefined): Promise<ObjectSymbolIndex> {
  if (linked === undefined) return (await readObjectSymbolIndex(dir)).index;
  const objects: ObjectSymbols[] = [];
  for (const object of await listObjectFiles(dir)) {
    if (!linked.has(object)) continue;
    const parsed = parseElf(new Uint8Array(await readFile(join(dir, object))));
    if (parsed.ok) objects.push({ object, symbols: parsed.value.symbols });
  }
  return indexObjectSymbols(objects);
}

/** Every agreeing function of the ROM compared with its reference object, in entry order. */
export async function compareFunctions(inputs: ObjdiffInputs): Promise<ComparedFunction[]> {
  const { rom, analysis } = inputs;
  const tools = inputs.tools ?? findBinutils(process.env);
  if ('code' in tools) throw new Error(`the objdiff family needs binutils: ${tools.message}`);
  const found = analysis.functions.map((f) => ({ entry: f.entry, end: f.extent.end }));
  const agreeing = agreeingFunctions(found, inputs.truth, analysis.startup.span.end);
  const config = namedConfig(configFromDiscover(rom, analysis), rom, inputs.symbols, found);
  const model = buildModel(rom, analysis, config);
  const chunkAt = new Map<number, number>();
  model.chunks.forEach((c, i) => {
    if (c.kind === 'function') chunkAt.set(c.span.start, i);
  });
  const index = await symbolIndex(inputs.objectsDir, inputs.linkedObjects);
  const names = new Map(model.functions.map((f) => [f.entry, f.name] as const));
  const jobs: Job[] = agreeing.map(({ found: f, elf }, n) => {
    const name = names.get(f.entry) ?? elf.name;
    return { n, name, chunk: chunkAt.get(f.entry), object: objectFor(index, name) };
  });
  const out = new Map<number, ComparedFunction>();
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    const refused = unpairable(job, index);
    if (refused !== undefined) out.set(job.n, refused);
    else if (job.object !== undefined) groups.set(job.object, [...(groups.get(job.object) ?? []), job]);
  }
  const dir = await mkdtemp(join(tmpdir(), 'romlift-objdiff-'));
  try {
    const cx: Context = { inputs, model, tools, dir };
    const ordered = [...groups.keys()].sort(compareCodeUnits).map((object): Group => ({ object, jobs: groups.get(object) ?? [] }));
    const results = await pooled(ordered, inputs.concurrency ?? availableParallelism(), (group) => compareGroup(group, cx));
    ordered.forEach((group, g) => group.jobs.forEach((job, i) => {
      const c = results[g]?.[i];
      if (c !== undefined) out.set(job.n, c);
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return jobs.map((job) => out.get(job.n) ?? { name: job.name, failure: { kind: 'tool', detail: 'not compared' } });
}

/** The objdiff member of a ROM whose readable build linked. */
export async function scoreObjdiff(inputs: ObjdiffInputs): Promise<ObjdiffSummary> {
  return linkedSummary(objdiffVerdict(await compareFunctions(inputs)));
}
