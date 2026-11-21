// The objdiff family (architecture §8.4 "objdiff", D34): on a tuning ROM whose readable build links, every
// function whose entry and extent agree with the ELF (score.ts agreeingFunctions) is compared by objdiff-cli
// (objdiff-cli.ts, the version of bench/tools/objdiff.version) with its reference object (objects.ts): with the
// map, the object or archive member whose linked input section holds its entry (archive members extracted with
// `ar`); without it, the object that defines its name. The model is the seedless discover run's config with the
// ELF's names and sizes put in by address (namedConfig), and the base is assembled per reference object
// (phase-3.md Q1 option a): every chunk the object's linked sections cover, the function writer's texts unchanged
// under one preamble (objectSource), so a call `as` resolved inside the reference object resolves inside the base;
// then its labels renamed and bound as the object's own symbol table names and binds them (nameBase: its statics and
// aliases, the externals its relocations name). Every word keeps romlift's own spelling (the printer's, D102: the bench
// rewrites none). One objdiff-cli run per object.
//
// Each difference has a kind, and a class (objdiff-classes.ts, which checks whether its two sides link to the same
// word). D34 as the owner amended it (D102) gates only the classes that differ in a word, or are unverified, or that
// objdiff scored apart (isGated), up to each tuning ROM's ceiling (g6.objdiff, g3.objdiff until the owner moved it to
// phase 5, D68 a, g5.objdiff until he skipped phase 5, D92); the same-word classes, the uncompared functions and
// `unnamed-target` (a relocation whose reference side targets a section symbol) are reported. The kinds:
//   instruction         a row whose instruction differs
//   resolved-call       a `bl` or `b` the reference's assembler resolved inside its object, which the base
//                       relocates against the same target (the same call, counted apart)
//   relocation          a relocation whose targets differ, or that only the base carries
//   missing-relocation  the reference relocates to a named symbol where the base holds a plain value
//   missing-symbol      no reference object defines the name, or objdiff paired nothing with it
//   score               objdiff paired it with no differing row and scored it below 100%
//   assemble            the base did not assemble
//   tool                objdiff-cli failed on the pair
// objdiffVerdict is pure; scoreObjdiff runs the tools.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  type AnalysisResult,
  type ElfFile,
  type ElfSymbol,
  type FunctionConfig,
  type GnuMap,
  type Label,
  MACROS_PATH,
  type Model,
  type Rom,
  type RomliftConfig,
  type SymbolConfig,
  buildModel,
  compareCodeUnits,
  configFromDiscover,
  contains,
  itemAt,
  parseElf,
  printChunk,
  regionOf,
} from 'romlift';
import { DIALECT } from 'romlift/isa';
import { type Binutils, assembleWithBinutils, findBinutils } from 'romlift/node';

import {
  type NameAddresses,
  OBJDIFF_CLASSES,
  classTotals,
  countClasses,
  isGated,
  nameAddresses,
  objdiffClass,
} from './objdiff-classes.ts';
import { type FunctionDiff, diffObjects } from './objdiff-cli.ts';
import {
  type Definition,
  type LinkedInput,
  type ObjectName,
  type ObjectRelocation,
  type ObjectSymbolIndex,
  type ObjectSymbols,
  indexObjectSymbols,
  inputAt,
  linkedInputs,
  listObjectFiles,
  memberKey,
  objectFor,
  objectNames,
  objectRelocations,
  parseMemberKey,
  readObjectSymbolIndex,
} from './objects.ts';
import { runProcess } from './process.ts';
import { agreeingFunctions } from './score.ts';
import type { Truth } from './truth.ts';

/** The one kind that is reported and not gated (D34). */
export const REPORTED_ONLY = 'unnamed-target' as const;

/** The examples kept per kind. */
export const EXAMPLES_PER_KIND = 5;

export interface ObjdiffExample {
  readonly function: string;
  readonly kind: string;
  readonly detail: string;
}

/** The kinds of difference functionDifferences gives (the header's list). */
export type ObjdiffKind =
  | 'instruction'
  | 'resolved-call'
  | 'relocation'
  | 'missing-relocation'
  | 'missing-symbol'
  | 'score'
  | 'assemble'
  | 'tool'
  | 'unnamed-target';

/**
 * What a difference's detail text does not say and bench/src/objdiff-classes.ts needs to check that its two sides
 * link to the same word: where the reference function's section starts in the linked image, the row's section
 * offset, and for a relocation its type, the reference addend and the base addend or plain value. Each is absent
 * when it is not known (no entry, an object table without the entry, a type the reader does not decode).
 */
export interface DifferenceFacts {
  /** The linked address of offset 0 of the reference function's section: its entry minus its section offset. */
  readonly sectionBase?: number;
  /** The reference row's section offset. */
  readonly offset?: number;
  readonly relocationType?: number;
  readonly referenceAddend?: number;
  readonly baseAddend?: number;
  readonly baseField?: number;
}

/** One difference: what the family reports of it (example), its kind, and the facts its classes are checked by. */
export interface ObjdiffDifference {
  readonly kind: ObjdiffKind;
  readonly example: ObjdiffExample;
  readonly facts: DifferenceFacts;
}

/** The differences of a ROM by class (objdiff-classes.ts), and what D34 as the owner amended it gates (D102). */
export interface ObjdiffClassSummary {
  /** Per class that occurs, the number of differences, in OBJDIFF_CLASSES order. */
  readonly counts: Readonly<Record<string, number>>;
  /** The differences D34 as amended gates (objdiff-classes.ts isGated); g6.objdiff holds it to the ROM's ceiling. */
  readonly gated: number;
  /** The functions objdiff did not compare (missing-symbol, tool): counted and reported, not gated. */
  readonly uncompared: number;
  /** Up to EXAMPLES_PER_KIND gated differences per class, `kind` holding the class, by class, then function, then detail. */
  readonly gatedExamples: readonly ObjdiffExample[];
}

/** A tuning row's `objdiff` member (read by test/gates/g6.objdiff.test.ts). */
export interface ObjdiffSummary {
  /** The readable build reproduced the SHA-1. */
  readonly linked: boolean;
  /** The functions compared: those whose entry and extent agree with the ELF. */
  readonly scored: number;
  /** Per kind, the number of differences, kinds in code-unit order. */
  readonly differences: Readonly<Record<string, number>>;
  /** Up to EXAMPLES_PER_KIND per kind, by kind, then function, then detail. */
  readonly examples: readonly ObjdiffExample[];
  /** By class (D102); absent in an artifact written before fix round 4's step 4 of phase 6, and on a ROM not linked. */
  readonly classes?: ObjdiffClassSummary;
}

/** One compared function: objdiff's result for it, or why there is none. */
export type ComparedFunction =
  | {
      readonly name: string;
      readonly diff: FunctionDiff | undefined;
      /** The reference object's function offsets by name, which tell a call `as` resolved inside it (resolvedCall). */
      readonly referenceFunctions?: ReadonlyMap<string, number>;
      /** The function's entry, the address the ELF and the analysis agree it starts at. */
      readonly entry?: number;
    }
  | {
      readonly name: string;
      readonly failure: { readonly kind: 'missing-symbol' | 'assemble' | 'tool'; readonly detail: string };
    };

/** A call or branch `as` resolved inside its object: the mnemonic (`bl`, `b`) and the target's offset. */
const RESOLVED_BRANCH = /^(bl|b) 0x([0-9a-f]+)$/;
/** The same branch relocated against a symbol: the mnemonic, the name and the PC addend (-4 Thumb, -8 ARM). */
const RELOCATED_BRANCH = /^(bl|b) ([A-Za-z_.$][A-Za-z0-9_.$]*)-0x[48]$/;

/**
 * The callee when a differing row is one call or branch spelled two ways: the reference's `bl <offset>` or
 * `b <offset>`, which `as` resolved because the target lies in the same object, and the base's `bl <name>-0x4`
 * (`-0x8` in ARM state) or `b <name>-0x4`, a relocation against that target because the base holds one
 * function, where the reference object defines <name> at <offset>.
 */
export function resolvedCall(
  kind: string,
  reference: string | null,
  base: string | null,
  functions: ReadonlyMap<string, number> | undefined,
): string | undefined {
  if (kind !== 'arg-mismatch' || functions === undefined) return undefined;
  const resolved = RESOLVED_BRANCH.exec(reference ?? '');
  const relocated = RELOCATED_BRANCH.exec(base ?? '');
  if (resolved === null || relocated === null || resolved[1] !== relocated[1]) return undefined;
  const callee = relocated[2] ?? '';
  return functions.get(callee) === Number.parseInt(resolved[2] ?? '', 16) ? callee : undefined;
}

const offsetText = (offset: number | null): string => (offset === null ? 'base only' : `+0x${offset.toString(16)}`);

/** The differences of one function, each with its kind and the facts its classes are checked by. */
export function objdiffDifferences(compared: ComparedFunction): ObjdiffDifference[] {
  const name = compared.name;
  const one = (kind: ObjdiffKind, detail: string, facts: DifferenceFacts = {}): ObjdiffDifference => ({
    kind,
    example: { function: name, kind, detail },
    facts,
  });
  if ('failure' in compared) return [one(compared.failure.kind, compared.failure.detail)];
  const diff = compared.diff;
  if (diff === undefined) return [one('missing-symbol', 'the reference object lists no function of that name')];
  if (!diff.paired) return [one('missing-symbol', 'objdiff paired no base symbol with it')];
  const where = (offset: number | null): DifferenceFacts => ({
    ...(compared.entry === undefined ? {} : { sectionBase: compared.entry - diff.offset }),
    ...(offset === null ? {} : { offset }),
  });
  const out: ObjdiffDifference[] = [];
  for (const d of diff.instructionDifferences) {
    const callee = resolvedCall(d.kind, d.reference, d.base, compared.referenceFunctions);
    const detail = `${offsetText(d.offset)} ${d.kind}: ${d.reference ?? '(none)'} | ${d.base ?? '(none)'}`;
    out.push(
      callee === undefined
        ? one('instruction', detail, where(d.offset))
        : one('resolved-call', `${detail} (${callee} is at that offset of the reference object)`, where(d.offset)),
    );
  }
  for (const r of diff.relocationDifferences) {
    const at = `${offsetText(r.offset)} ${r.type}`;
    const facts: DifferenceFacts = {
      ...where(r.offset),
      ...(r.typeCode === undefined ? {} : { relocationType: r.typeCode }),
      ...(r.reference?.addend === undefined ? {} : { referenceAddend: r.reference.addend }),
      ...(r.baseAddend === undefined ? {} : { baseAddend: r.baseAddend }),
      ...(r.baseField === undefined ? {} : { baseField: r.baseField }),
    };
    if (r.reference?.symbol === 'section')
      out.push(one(REPORTED_ONLY, `${at}: section ${r.reference.name} | ${r.base ?? 'no relocation'}`, facts));
    else if (r.reference !== null && r.base === null)
      out.push(one('missing-relocation', `${at}: ${r.reference.name} | a plain value`, facts));
    else
      out.push(
        one('relocation', `${at}: ${r.reference?.name ?? 'no relocation'} | ${r.base ?? 'no relocation'}`, facts),
      );
  }
  if (out.length === 0 && diff.matchPercent !== 100)
    out.push(one('score', `objdiff scored it ${String(diff.matchPercent)}% with no differing row`));
  return out;
}

/** The differences of one function, each with its kind (what the family reports). */
export function functionDifferences(compared: ComparedFunction): ObjdiffExample[] {
  return objdiffDifferences(compared).map((d) => d.example);
}

const byExample = (a: ObjdiffExample, b: ObjdiffExample): number =>
  compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.function, b.function) || compareCodeUnits(a.detail, b.detail);

export interface ObjdiffVerdict {
  readonly scored: number;
  readonly differences: Readonly<Record<string, number>>;
  readonly examples: readonly ObjdiffExample[];
  /** The classes of D34 as amended (D102): what g6.objdiff holds to the ROM's ceiling (`gated`), the one pass rule. */
  readonly classes: ObjdiffClassSummary;
}

/** Up to EXAMPLES_PER_KIND of `sorted` per value of `key`, in the order given. */
function capped(sorted: readonly ObjdiffExample[], key: (e: ObjdiffExample) => string): ObjdiffExample[] {
  const out: ObjdiffExample[] = [];
  const shown = new Map<string, number>();
  for (const e of sorted) {
    const n = shown.get(key(e)) ?? 0;
    if (n >= EXAMPLES_PER_KIND) continue;
    shown.set(key(e), n + 1);
    out.push(e);
  }
  return out;
}

/** The verdict over every compared function of a ROM, each difference classed with the reference's names (`addressesOf`); pure. */
export function objdiffVerdict(compared: readonly ComparedFunction[], addressesOf: NameAddresses): ObjdiffVerdict {
  const found = compared.flatMap(objdiffDifferences);
  const all = found.map((d) => d.example).sort(byExample);
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1);
  const differences: Record<string, number> = {};
  for (const kind of [...counts.keys()].sort(compareCodeUnits)) differences[kind] = counts.get(kind) ?? 0;
  // Each difference classed once; the counts and the gated examples both read that one array.
  const classed = found.map((d) => ({ example: d.example, cls: objdiffClass(d, addressesOf) }));
  const perClass = countClasses(classed.map((d) => d.cls));
  const totals = classTotals(perClass);
  const occurring: Record<string, number> = {};
  for (const c of OBJDIFF_CLASSES) if (perClass[c] > 0) occurring[c] = perClass[c];
  const gatedRows = classed.flatMap((d) => (isGated(d.cls) ? [{ ...d.example, kind: d.cls }] : []));
  const classes: ObjdiffClassSummary = {
    counts: occurring,
    gated: totals.gated,
    uncompared: totals.uncompared,
    gatedExamples: capped(gatedRows.sort(byExample), (e) => e.kind),
  };
  return { scored: compared.length, differences, examples: capped(all, (e) => e.kind), classes };
}

/** The member of a ROM whose readable build does not link: nothing is scored (g6.objdiff notes it). */
export function unlinkedSummary(): ObjdiffSummary {
  return { linked: false, scored: 0, differences: {}, examples: [] };
}

export function linkedSummary(verdict: ObjdiffVerdict): ObjdiffSummary {
  return {
    linked: true,
    scored: verdict.scored,
    differences: verdict.differences,
    examples: verdict.examples,
    classes: verdict.classes,
  };
}

// ---------------------------------------------------------------------------------------------------
// The base: the discover config with the ELF's names

/** The first reserved section index (SHN_LORESERVE): an absolute or common symbol has no section of its own. */
const SHN_LORESERVE = 0xff00;

/** What namedConfig gives an assembler symbol name (the config schema's rule). */
const SYMBOL_NAME = /^[A-Za-z_.$][A-Za-z0-9_.$]*$/;

/** Whether an ELF symbol names a function or a piece of data a label can carry. */
function isNameable(s: ElfSymbol): boolean {
  if (!SYMBOL_NAME.test(s.name) || s.name.startsWith('$') || s.name.startsWith('.L')) return false;
  return s.type === 'func' || s.type === 'object' || s.type === 'notype';
}

/**
 * The size of each nameable symbol: the ELF's, else (an untyped label of an assembly file or a linker script, which
 * the ELF gives no size) up to the next nameable symbol of its section, the size objdiff gives an unsized symbol; 0
 * for the last symbol of a section. An absolute symbol (no section) keeps the ELF's size.
 */
export function symbolSizes(symbols: readonly ElfSymbol[]): Map<ElfSymbol, number> {
  const bySection = new Map<number, ElfSymbol[]>();
  for (const s of symbols)
    if (isNameable(s) && s.sectionIndex < SHN_LORESERVE)
      bySection.set(s.sectionIndex, [...(bySection.get(s.sectionIndex) ?? []), s]);
  const out = new Map<ElfSymbol, number>();
  for (const s of symbols) if (s.sectionIndex >= SHN_LORESERVE) out.set(s, s.size);
  for (const list of bySection.values()) {
    const addrs = [...new Set(list.map((s) => s.addr))].sort((a, b) => a - b);
    for (const s of list) {
      if (s.size > 0) out.set(s, s.size);
      else {
        const next = addrs[lowerBoundOf(addrs, s.addr + 1)];
        out.set(s, next === undefined ? 0 : next - s.addr);
      }
    }
  }
  return out;
}

/** The index of the first of `sorted` at or above `key`. */
function lowerBoundOf(sorted: readonly number[], key: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One name per address, a global or weak definition before a local one, then the first in the table; with its size. */
function namesByAddr(
  symbols: readonly ElfSymbol[],
  sizes: ReadonlyMap<ElfSymbol, number>,
  keep: (s: ElfSymbol) => boolean,
): Map<number, { readonly name: string; readonly size: number }> {
  const out = new Map<number, { readonly name: string; readonly size: number; readonly global: boolean }>();
  for (const s of symbols) {
    if (!isNameable(s) || !keep(s)) continue;
    const global = s.bind !== 'local';
    const had = out.get(s.addr);
    if (had === undefined || (global && !had.global))
      out.set(s.addr, { name: s.name, size: sizes.get(s) ?? s.size, global });
  }
  return new Map([...out].map(([addr, v]) => [addr, { name: v.name, size: v.size }] as const));
}

/**
 * Whether a symbol outside the ROM names memory the game's code addresses: work RAM, I/O, video or save memory, never
 * the BIOS addresses, where a decomp lays out pseudo-sections (pokeemerald's `.pseudo.*` NOBITS sections at 0 hold the
 * save-block layouts, so a symbol there is an offset, not an address).
 */
function isAddressedMemory(addr: number): boolean {
  const region = regionOf(addr);
  return region !== undefined && region.kind !== 'bios';
}

/**
 * The discover config with the reference ELF's names and sizes by address (D34): each listed function takes the ELF
 * `FUNC` name at its entry, and every `OBJECT` or untyped symbol of the ROM outside every function's extent, and
 * every one outside the ROM that a section of the ELF defines in addressed memory (RAM, I/O, video, save; symbols.ld
 * defines them), becomes a symbol with its size (symbolSizes), so the data labels and the RAM addresses the code names
 * carry the reference's names, and a word inside a symbol prints `name + offset` as the reference relocates it
 * (pool.ts). An absolute symbol (an I/O register such as REG_DMA3, INTR_VECTOR) is left out: the reference's code holds
 * those as plain constants, never as relocations. A name the ELF uses at two addresses (two static definitions) is
 * given to neither, so the model keeps one name per label.
 */
export function namedConfig(
  config: RomliftConfig,
  rom: Rom,
  symbols: readonly ElfSymbol[],
  extents: readonly { readonly entry: number; readonly end: number }[],
): RomliftConfig {
  const inside = (addr: number): boolean => extents.some((f) => addr >= f.entry && addr < f.end);
  const sizes = symbolSizes(symbols);
  const listed = (addr: number): boolean => config.functions.has(addr) || config.entryPoints.has(addr);
  const funcs = namesByAddr(symbols, sizes, (s) => s.type === 'func' && listed(s.addr));
  const data = namesByAddr(
    symbols,
    sizes,
    (s) =>
      s.type !== 'func' &&
      (contains(rom, s.addr)
        ? !listed(s.addr) && !inside(s.addr)
        : s.sectionName !== undefined && isAddressedMemory(s.addr)),
  );
  const uses = new Map<string, number>();
  for (const { name } of [...funcs.values(), ...data.values()]) uses.set(name, (uses.get(name) ?? 0) + 1);
  const unique = (name: string): boolean => uses.get(name) === 1;
  const withElf = <T extends FunctionConfig>(table: ReadonlyMap<number, T>): Map<number, T> => {
    const out = new Map<number, T>();
    for (const [addr, f] of table) {
      const elf = funcs.get(addr);
      const sized = elf !== undefined && elf.size > 0 ? { ...f, size: elf.size } : f;
      out.set(addr, elf !== undefined && unique(elf.name) ? { ...sized, name: elf.name, aliases: [] } : sized);
    }
    return out;
  };
  const named = new Map<number, SymbolConfig>(config.symbols);
  for (const [addr, { name, size }] of data)
    if (unique(name) && !named.has(addr))
      named.set(addr, size > 0 ? { name, size, aliases: [] } : { name, aliases: [] });
  return { ...config, functions: withElf(config.functions), entryPoints: withElf(config.entryPoints), symbols: named };
}

/** The chunks of its module that hold a word chunk `chunk`'s PC-relative loads and adrs reach outside it. */
function reachedChunks(rom: Rom, model: Model, chunk: number): number[] {
  const c = model.chunks[chunk];
  if (c === undefined) return [];
  const offset = c.runAt === undefined ? 0 : c.runAt - c.span.start;
  const out: number[] = [];
  for (let i = c.items.first; i < c.items.first + c.items.count; i++) {
    const item = itemAt(model.items, i, rom, offset);
    if (item.kind !== 'insn' && item.kind !== 'raw-insn') continue;
    const flow = item.insn?.flow;
    const reached = flow?.kind === 'pool-load' ? flow.pool : flow?.kind === 'adr' ? flow.target : undefined;
    if (reached === undefined) continue;
    const load = reached - offset;
    if (load >= c.span.start && load < c.span.end) continue;
    const at = model.chunks.findIndex((k) => k.module === c.module && load >= k.span.start && load < k.span.end);
    if (at >= 0) out.push(at);
  }
  return out;
}

/**
 * The chunks a function chunk must be assembled with: the smallest run of chunks of its module around it that
 * holds every word a PC-relative load or adr of any chunk of the run reaches (a far pool, an adr target). GNU as
 * cannot relocate a PC-relative reference into another object (D63), so a function assembled alone would not
 * assemble; with the chunks between, every distance is the tree's.
 */
export function pcRelativeChunkRange(
  rom: Rom,
  model: Model,
  chunk: number,
): { readonly first: number; readonly last: number } {
  let first = chunk;
  let last = chunk;
  const done = new Set<number>();
  for (let grew = true; grew; ) {
    grew = false;
    for (let k = first; k <= last; k++) {
      if (done.has(k)) continue;
      done.add(k);
      for (const at of reachedChunks(rom, model, k)) {
        if (at < first || at > last) grew = true;
        first = Math.min(first, at);
        last = Math.max(last, at);
      }
    }
  }
  return { first, last };
}

/**
 * The base text of the function chunk at `chunk`: the dialect preamble, then the function writer's text, with the
 * chunks of its pcRelativeChunkRange around it, so a function whose pool lies in another chunk assembles. When
 * the first of them starts off a word (a Thumb entry at 2 mod 4), as many zero bytes come first, so every
 * PC-relative distance (Align(PC, 4) based) is the one it has in the ROM.
 */
export function functionSource(rom: Rom, model: Model, chunk: number): string {
  const c = model.chunks[chunk];
  const { first, last } = pcRelativeChunkRange(rom, model, chunk);
  const start = model.chunks[first]?.span.start ?? 0;
  const lines: string[] = start % 4 === 0 ? [] : [`\t.space ${start % 4}`];
  for (let k = first; k <= last; k++) for (const line of printChunk(rom, model, k, 'readable').lines) lines.push(line);
  return `${DIALECT.preamble(model.chunks[first]?.mode ?? c?.mode ?? 'thumb')}${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------
// The base of one reference object, named as that object names things

/** A label of the base text: its address, whether it is a function, and whether the text defines it. */
export interface BaseLabel {
  readonly addr: number;
  readonly func: boolean;
  readonly defined: boolean;
}

/** An identifier token of an assembler line (a name never follows a letter, digit, `_`, `.` or `$`). */
const IDENTIFIER = /(?<![A-Za-z0-9_.$])[A-Za-z_.$][A-Za-z0-9_.$]*/g;
/** A function start macro line (dialect.ts): its macro, whether it is the `_local` one, and the name. */
const START_LINE = /^\t(arm_func_start|thumb_func_start|non_word_aligned_thumb_func_start)(_local)? (\S+)$/;
const GLOBAL_LINE = /^\.global (\S+)$/;

/**
 * The renames that give the base the reference object's names: each label of the text at an address the object names
 * (`names`, its preferred name per address) takes that name, unless a token of the text that stays holds it for
 * another address, or an earlier address takes it (the label then keeps the model's name). A token is a label's name
 * only through `labelOf`; a token that is no label holds nothing.
 */
export function baseRenames(
  tokens: ReadonlySet<string>,
  labelOf: (name: string) => BaseLabel | undefined,
  names: ReadonlyMap<number, ObjectName>,
): Map<string, string> {
  let wanted: { readonly from: string; readonly to: string; readonly addr: number }[] = [];
  for (const token of tokens) {
    const label = labelOf(token);
    const to = label === undefined ? undefined : names.get(label.addr)?.name;
    if (label !== undefined && to !== undefined && to !== token) wanted.push({ from: token, to, addr: label.addr });
  }
  wanted.sort((a, b) => a.addr - b.addr || compareCodeUnits(a.from, b.from));
  for (;;) {
    const renamed = new Set(wanted.map((w) => w.from));
    const held = new Map<string, number>();
    for (const t of tokens) {
      const label = labelOf(t);
      if (!renamed.has(t) && label !== undefined) held.set(t, label.addr);
    }
    const kept = wanted.filter((w) => {
      const at = held.get(w.to);
      if (at !== undefined && at !== w.addr) return false;
      held.set(w.to, w.addr);
      return true;
    });
    if (kept.length === wanted.length) return new Map(kept.map((w) => [w.from, w.to] as const));
    wanted = kept;
  }
}

/**
 * The binding each label the text defines takes after the renames: the object's own (local or global) when the object
 * defines that name at that address, global for a function the object does not define (another object's, which the
 * reference reaches through a relocation), unchanged otherwise.
 */
export function baseBindings(
  defined: readonly { readonly name: string; readonly label: BaseLabel }[],
  names: ReadonlyMap<number, ObjectName>,
): Map<string, 'local' | 'global'> {
  const out = new Map<string, 'local' | 'global'>();
  for (const { name, label } of defined) {
    const own = names.get(label.addr);
    if (own !== undefined && own.defined && own.name === name) out.set(name, own.bind);
    else if (label.func) out.set(name, 'global');
  }
  return out;
}

/**
 * The base text of a reference object named and bound as the object names and binds its symbols (D34's labels renamed
 * to the reference's names, per reference object): every label token the renames name is replaced, then each defined
 * label takes its binding (a function's start macro its `_local` form or not, a `.global` line dropped or added), so
 * `as` resolves a call inside the base exactly where it resolved it inside the reference object.
 */
export function nameBase(
  text: string,
  labelOf: (name: string) => BaseLabel | undefined,
  names: ReadonlyMap<number, ObjectName>,
): string {
  const tokens = new Set(text.match(IDENTIFIER) ?? []);
  const renames = baseRenames(tokens, labelOf, names);
  const renamed = renames.size === 0 ? text : text.replace(IDENTIFIER, (t) => renames.get(t) ?? t);
  const defined: { readonly name: string; readonly label: BaseLabel }[] = [];
  for (const token of tokens) {
    const label = labelOf(token);
    if (label?.defined === true) defined.push({ name: renames.get(token) ?? token, label });
  }
  const binds = baseBindings(defined, names);
  const globals = new Set<string>();
  const lines: string[] = [];
  for (const line of renamed.split('\n')) {
    const start = START_LINE.exec(line);
    const global = GLOBAL_LINE.exec(line);
    const name = start?.[3] ?? global?.[1];
    const bind = name === undefined ? undefined : binds.get(name);
    if (start !== null && bind !== undefined) {
      lines.push(`\t${start[1] ?? ''}${bind === 'local' ? '_local' : ''} ${start[3] ?? ''}`);
      if (bind === 'global') globals.add(start[3] ?? '');
    } else if (global !== null && bind === 'local') {
      continue;
    } else {
      if (global !== null) globals.add(global[1] ?? '');
      lines.push(line);
    }
  }
  const missing = [...binds]
    .filter(([n, b]) => b === 'global' && !globals.has(n))
    .map(([n]) => `.global ${n}`)
    .sort(compareCodeUnits);
  if (missing.length === 0) return lines.join('\n');
  const last = lines.at(-1) === '' ? lines.pop() : undefined;
  return [...lines, ...missing, ...(last === undefined ? [] : [last])].join('\n');
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
  /**
   * The reference map. With it, a function's reference object is the one whose linked input section holds its entry
   * (not the one that defines its name), and the archive members it links (`lib*.a(member.o)`, relative to
   * objectsDir like its objects) are reference objects too, extracted with `ar` into a temporary directory.
   */
  readonly map?: GnuMap;
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
  /** Its position, which names its temporary files. */
  readonly n: number;
  /** The name the reference object gives it (the model's, when the object is found by name). */
  readonly name: string;
  /** The function's entry. */
  readonly entry: number;
  readonly chunk: number | undefined;
  /** Its reference object's key; undefined with `refused`. */
  readonly object: string | undefined;
  /** Why it is not compared (a missing-symbol detail). */
  readonly refused?: string;
}

type Failure = Extract<ComparedFunction, { readonly failure: unknown }>;

/** A reference object as the family reads it: its symbols and sections, and its relocations. */
interface ReferenceFacts {
  readonly elf: ElfFile;
  readonly relocations: readonly ObjectRelocation[];
}

/** The reference side of one ROM. */
interface References {
  /** The file of an object key. */
  readonly path: (object: string) => string;
  /** The object's facts, read once; undefined when it is not an ARM ELF object. */
  readonly facts: (object: string) => Promise<ReferenceFacts | undefined>;
  /** With the map: every linked input section, in address order. */
  readonly inputs: readonly LinkedInput[] | undefined;
  /** The ELF's definition of a global or weak name, undefined when it has none or several. */
  readonly definitionOf: (name: string) => Definition | undefined;
  /** With the map: the object's preferred name per address (objectNames, its sections where the map links them). */
  readonly naming: (object: string) => Promise<ReadonlyMap<number, ObjectName> | undefined>;
}

/** The functions of one reference object, compared in one objdiff-cli run. */
interface Group {
  readonly object: string;
  readonly jobs: readonly Job[];
}

interface Context {
  readonly inputs: ObjdiffInputs;
  readonly model: Model;
  readonly tools: Binutils;
  readonly dir: string;
  readonly references: References;
  /** A model label by name, with its address and kind; undefined for a name two labels share. */
  readonly labelByName: ReadonlyMap<string, Label | null>;
}

/** Where one section of a reference object is linked: [start, end) of the image. */
export interface LinkedSpan {
  readonly section: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Where the sections of a reference object that hold the group's functions are linked: each function's entry minus
 * its offset in the object (its `func` symbol's value without the Thumb bit), the section's size on. A section two
 * functions place at different addresses is left out (the object is not the linked one).
 */
export function linkedSpans(
  object: Pick<ElfFile, 'sections' | 'symbols'>,
  functions: readonly { readonly name: string; readonly entry: number }[],
): LinkedSpan[] {
  const starts = new Map<string, number | null>();
  for (const f of functions) {
    const s = object.symbols.find((x) => x.name === f.name && x.type === 'func' && x.sectionName !== undefined);
    if (s?.sectionName === undefined) continue;
    const start = f.entry - s.addr;
    const had = starts.get(s.sectionName);
    starts.set(s.sectionName, had === undefined || had === start ? start : null);
  }
  const out: LinkedSpan[] = [];
  for (const [section, start] of [...starts].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    const size = object.sections.find((x) => x.name === section)?.size ?? 0;
    if (start !== null && size > 0) out.push({ section, start, end: start + size });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The chunks of a reference object's base, in model (ROM) order: every chunk that overlaps one of the object's linked
 * spans, so a call between two functions of the object resolves in the base as `as` resolved it in the reference,
 * and each one's pcRelativeChunkRange, so every far pool and adr target is assembled with the code that reaches it.
 * `seeds` (the group's own function chunks) are always included.
 */
export function objectChunks(rom: Rom, model: Model, spans: readonly LinkedSpan[], seeds: readonly number[]): number[] {
  const picked = new Set<number>(seeds);
  model.chunks.forEach((c, i) => {
    if (spans.some((s) => c.span.start < s.end && c.span.end > s.start)) picked.add(i);
  });
  for (const i of [...picked]) {
    const { first, last } = pcRelativeChunkRange(rom, model, i);
    for (let k = first; k <= last; k++) picked.add(k);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The base text of a reference object: the dialect preamble, then the function writer's text of each chunk, in
 * order. A chunk that does not follow the one before it starts a new run, word aligned and then as many zero bytes as
 * its ROM address lies past a word, so every PC-relative distance (Align(PC, 4) based) is the one it has in the ROM.
 */
export function objectSource(rom: Rom, model: Model, chunks: readonly number[]): string {
  const lines: string[] = [];
  let previous: number | undefined;
  for (const k of chunks) {
    const start = model.chunks[k]?.span.start ?? 0;
    if (previous === undefined || k !== previous + 1) {
      if (previous !== undefined) lines.push('\t.balign 4, 0');
      if (start % 4 !== 0) lines.push(`\t.space ${start % 4}`);
    }
    for (const line of printChunk(rom, model, k, 'readable').lines) lines.push(line);
    previous = k;
  }
  return `${DIALECT.preamble(model.chunks[chunks[0] ?? 0]?.mode ?? 'thumb')}${lines.join('\n')}\n`;
}

/** The index of the first label at or after `addr` (labels sorted by address). */
function firstLabelAt(labels: readonly Label[], addr: number): number {
  let lo = 0;
  let hi = labels.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((labels[mid]?.addr ?? 0) < addr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The labels the chunks define: every model label inside their spans, and their inner labels. */
function definedNames(model: Model, chunks: readonly number[]): Set<string> {
  const out = new Set<string>();
  for (const k of chunks) {
    const c = model.chunks[k];
    if (c === undefined) continue;
    out.add(c.name);
    for (const l of c.innerLabels) out.add(l.name);
    for (let i = firstLabelAt(model.labels, c.span.start); i < model.labels.length; i++) {
      const l = model.labels[i];
      if (l === undefined || l.addr >= c.span.end) break;
      out.add(l.name);
    }
  }
  return out;
}

/** Assembles `source`; the object's path, or the assembler's complaint. */
async function assembleText(
  source: string,
  path: string,
  cx: Context,
): Promise<{ readonly path: string } | { readonly error: string }> {
  const assembled = await assembleWithBinutils(source, {
    files: { [MACROS_PATH]: DIALECT.macrosInc },
    tools: cx.tools,
  });
  if (!assembled.ok)
    return { error: assemblerError(assembled.stderr) ?? assembled.diagnostics[0]?.message ?? 'as failed' };
  await writeFile(path, assembled.object);
  return { path };
}

/** One objdiff-cli run of the reference object against `base`, read for each job's function. */
async function diffJobs(cx: Context, object: string, base: string, jobs: readonly Job[]): Promise<ComparedFunction[]> {
  const diffed = await diffObjects(cx.inputs.objdiff, cx.references.path(object), base);
  if (!diffed.ok)
    return jobs.map((job) => ({
      name: job.name,
      failure: { kind: 'tool' as const, detail: `${object}: ${toolError(diffed.error)}` },
    }));
  const referenceFunctions = new Map(diffed.value.functions.map((f) => [f.name, f.offset] as const));
  return jobs.map((job) => ({
    name: job.name,
    diff: diffed.value.functions.find((f) => f.name === job.name),
    referenceFunctions,
    entry: job.entry,
  }));
}

/**
 * The first (preferred) of objectNames' names at each address, leaving out a name the object defines at the BIOS
 * addresses (a section laid out there, isAddressedMemory: an offset, not an address).
 */
export function preferredNames(names: readonly ObjectName[]): Map<number, ObjectName> {
  const out = new Map<number, ObjectName>();
  for (const n of names) if (!out.has(n.addr) && (!n.defined || isAddressedMemory(n.addr))) out.set(n.addr, n);
  return out;
}

/** The base text of a group: its object's chunks, named and bound as the object names them. */
async function groupSource(group: Group, cx: Context): Promise<string> {
  const { rom } = cx.inputs;
  const facts = await cx.references.facts(group.object);
  const linked = cx.references.inputs?.filter((i) => i.object === group.object) ?? [];
  const spans =
    linked.length > 0
      ? linked.filter((i) => group.jobs.some((j) => j.entry >= i.start && j.entry < i.end))
      : facts === undefined
        ? []
        : linkedSpans(facts.elf, group.jobs);
  const seeds = group.jobs.flatMap((j) => (j.chunk === undefined ? [] : [j.chunk]));
  const chunks = objectChunks(rom, cx.model, spans, seeds);
  const text = objectSource(rom, cx.model, chunks);
  if (facts === undefined) return text;
  const startOf = new Map(spans.map((s) => [s.section, s.start] as const));
  const names =
    (await cx.references.naming(group.object)) ??
    preferredNames(
      objectNames(
        { symbols: facts.elf.symbols, relocations: facts.relocations },
        (section) => startOf.get(section),
        cx.references.definitionOf,
      ),
    );
  const defined = definedNames(cx.model, chunks);
  const labelOf = (name: string): BaseLabel | undefined => {
    const l = cx.labelByName.get(name);
    return l === undefined || l === null
      ? undefined
      : { addr: l.addr, func: l.kind === 'func', defined: defined.has(name) };
  };
  return nameBase(text, labelOf, names);
}

/**
 * The functions of one reference object. The base is the object's chunks (objectChunks) in one file named as the
 * object names them (nameBase), assembled once, so a call `as` resolved inside the reference object resolves inside
 * the base; when that file does not assemble, each function is assembled alone (functionSource) and the objects
 * joined by a relocatable link (`ld -r`, which keeps every relocation), so objdiff-cli still reads the reference
 * object once.
 */
async function compareGroup(group: Group, cx: Context): Promise<ComparedFunction[]> {
  const path = join(cx.dir, `${group.jobs[0]?.n ?? 0}-object.o`);
  const whole = await assembleText(await groupSource(group, cx), path, cx);
  try {
    if ('path' in whole) return await diffJobs(cx, group.object, whole.path, group.jobs);
    return await compareApart(group, cx);
  } finally {
    await rm(path, { force: true });
  }
}

/** The fallback of compareGroup: each function assembled alone, then joined by `ld -r`. */
async function compareApart(group: Group, cx: Context): Promise<ComparedFunction[]> {
  const out = new Map<number, ComparedFunction>();
  const assembled: { readonly job: Job; readonly path: string }[] = [];
  for (const job of group.jobs) {
    const result = await assembleText(
      functionSource(cx.inputs.rom, cx.model, job.chunk ?? 0),
      join(cx.dir, `${job.n}.o`),
      cx,
    );
    if ('path' in result) assembled.push({ job, path: result.path });
    else out.set(job.n, { name: job.name, failure: { kind: 'assemble', detail: result.error } });
  }
  const merged = join(cx.dir, `${assembled[0]?.job.n ?? 0}-group.o`);
  if (assembled.length > 0) {
    const joined =
      assembled.length === 1
        ? { code: 0 }
        : await runProcess(cx.tools.ld, ['-r', '-o', merged, ...assembled.map((a) => a.path)]);
    const base = assembled.length === 1 ? (assembled[0]?.path ?? merged) : merged;
    const compared =
      joined.code === 0
        ? await diffJobs(
            cx,
            group.object,
            base,
            assembled.map((a) => a.job),
          )
        : (await Promise.all(assembled.map((a) => diffJobs(cx, group.object, a.path, [a.job])))).flat();
    compared.forEach((c, i) => {
      const job = assembled[i]?.job;
      if (job !== undefined) out.set(job.n, c);
    });
  }
  await Promise.all([...assembled.map((a) => rm(a.path, { force: true })), rm(merged, { force: true })]);
  return group.jobs.map(
    (job) => out.get(job.n) ?? { name: job.name, failure: { kind: 'tool', detail: 'not compared' } },
  );
}

/** The assembler's first error line (`source.s:12: Error: ...`), or its first line, or undefined when it printed nothing. */
export function assemblerError(stderr: string): string | undefined {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
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

/**
 * The ELF's definition of each global or weak name (an absolute one included), its size symbolSizes'; null for a name
 * defined at two addresses. A name of a section laid out at the BIOS addresses (isAddressedMemory) has none.
 */
export function globalDefinitions(symbols: readonly ElfSymbol[]): Map<string, Definition | null> {
  const sizes = symbolSizes(symbols);
  const out = new Map<string, Definition | null>();
  for (const s of symbols) {
    if (s.bind === 'local' || s.type === 'section' || s.type === 'file') continue;
    if (s.sectionIndex < SHN_LORESERVE && !isAddressedMemory(s.addr)) continue;
    const had = out.get(s.name);
    const size = sizes.get(s) ?? s.size;
    out.set(
      s.name,
      had === undefined || (had !== null && had.addr === s.addr)
        ? { addr: s.addr, size: Math.max(size, had?.size ?? 0) }
        : null,
    );
  }
  return out;
}

/** The `ar` beside the `as` of `tools` (`arm-none-eabi-as` gives `arm-none-eabi-ar`). */
export function arOf(tools: Pick<Binutils, 'as'>): string {
  return tools.as.replace(/as$/, 'ar');
}

/**
 * The archive members the map links, extracted with `ar x` into `dir` (one directory per archive): each member key's
 * file. A member `ar` cannot extract is left out (no reference object defines its names).
 */
async function extractMembers(
  inputs: readonly LinkedInput[],
  objectsDir: string,
  dir: string,
  ar: string,
): Promise<Map<string, string>> {
  const byArchive = new Map<string, Set<string>>();
  for (const i of inputs) {
    const m = parseMemberKey(i.object);
    if (m !== undefined) byArchive.set(m.archive, (byArchive.get(m.archive) ?? new Set<string>()).add(m.member));
  }
  const out = new Map<string, string>();
  let n = 0;
  for (const archive of [...byArchive.keys()].sort(compareCodeUnits)) {
    const into = join(dir, `archive-${n++}`);
    await mkdir(into, { recursive: true });
    const members = [...(byArchive.get(archive) ?? [])].sort(compareCodeUnits);
    const run = await runProcess(ar, ['x', isAbsolute(archive) ? archive : join(objectsDir, archive), ...members], {
      cwd: into,
    });
    if (run.code !== 0) continue;
    for (const member of members) out.set(memberKey(archive, member), join(into, member));
  }
  return out;
}

/** The reference side of a ROM: with the map, its linked inputs and extracted archive members. */
async function references(inputs: ObjdiffInputs, tools: Binutils, dir: string): Promise<References> {
  const linked = inputs.map === undefined ? undefined : linkedInputs(inputs.map);
  const members =
    linked === undefined
      ? new Map<string, string>()
      : await extractMembers(linked, inputs.objectsDir, dir, arOf(tools));
  const path = (object: string): string => members.get(object) ?? join(inputs.objectsDir, object);
  const cache = new Map<string, Promise<ReferenceFacts | undefined>>();
  const read = async (object: string): Promise<ReferenceFacts | undefined> => {
    const bytes = await readFile(path(object)).then(
      (b) => new Uint8Array(b),
      () => undefined,
    );
    if (bytes === undefined) return undefined;
    const elf = parseElf(bytes);
    const relocations = objectRelocations(bytes);
    return elf.ok && relocations.ok ? { elf: elf.value, relocations: relocations.value } : undefined;
  };
  const facts = (object: string): Promise<ReferenceFacts | undefined> => {
    let p = cache.get(object);
    if (p === undefined) cache.set(object, (p = read(object)));
    return p;
  };
  const definitions = globalDefinitions(inputs.symbols);
  const definitionOf = (name: string): Definition | undefined => definitions.get(name) ?? undefined;
  const usable = linked?.filter((i) =>
    parseMemberKey(i.object) === undefined ? (inputs.linkedObjects?.has(i.object) ?? true) : members.has(i.object),
  );
  const starts = new Map<string, Map<string, number>>();
  for (const i of usable ?? []) {
    const of = starts.get(i.object) ?? new Map<string, number>();
    if (!of.has(i.section)) of.set(i.section, i.start);
    starts.set(i.object, of);
  }
  const namings = new Map<string, Promise<ReadonlyMap<number, ObjectName> | undefined>>();
  const naming = (object: string): Promise<ReadonlyMap<number, ObjectName> | undefined> => {
    let p = namings.get(object);
    if (p === undefined) {
      p = facts(object).then((f) =>
        f === undefined || usable === undefined
          ? undefined
          : preferredNames(
              objectNames(
                { symbols: f.elf.symbols, relocations: f.relocations },
                (section) => starts.get(object)?.get(section),
                definitionOf,
              ),
            ),
      );
      namings.set(object, p);
    }
    return p;
  };
  return { path, facts, inputs: usable, definitionOf, naming };
}

/** The jobs of the agreeing functions: each one's reference object by its entry (with the map) or by its name. */
async function jobsOf(
  agreeing: readonly { readonly entry: number; readonly name: string }[],
  chunkAt: ReadonlyMap<number, number>,
  inputs: ObjdiffInputs,
  refs: References,
): Promise<Job[]> {
  if (refs.inputs === undefined) {
    const index = await symbolIndex(inputs.objectsDir, inputs.linkedObjects);
    return agreeing.map((f, n): Job => {
      const object = objectFor(index, f.name);
      const defs = index.definitions.get(f.name) ?? [];
      const refused =
        object !== undefined
          ? undefined
          : defs.length === 0
            ? 'no reference object defines it'
            : `it is defined ambiguously (${defs.map((d) => `${d.object} ${d.bind}`).join(', ')})`;
      return {
        n,
        name: f.name,
        entry: f.entry,
        chunk: chunkAt.get(f.entry),
        object,
        ...(refused === undefined ? {} : { refused }),
      };
    });
  }
  const linked = refs.inputs;
  return Promise.all(
    agreeing.map(async (f, n): Promise<Job> => {
      const chunk = chunkAt.get(f.entry);
      const input = inputAt(linked, f.entry);
      if (input === undefined)
        return {
          n,
          name: f.name,
          entry: f.entry,
          chunk,
          object: undefined,
          refused: 'no object or archive member the map links holds its entry',
        };
      const named = (await refs.naming(input.object))?.get(f.entry);
      const name = named?.defined === true && named.func ? named.name : undefined;
      if (name === undefined)
        return {
          n,
          name: f.name,
          entry: f.entry,
          chunk,
          object: undefined,
          refused: `${input.object} defines no function at ${input.section} + 0x${(f.entry - input.start).toString(16)}`,
        };
      return { n, name, entry: f.entry, chunk, object: input.object };
    }),
  );
}

/** Why a job is not compared at all: no reference object holds it, or the model has no chunk at its entry. */
function unpairable(job: Job): Failure | undefined {
  if (job.refused !== undefined || job.object === undefined)
    return {
      name: job.name,
      failure: { kind: 'missing-symbol', detail: job.refused ?? 'no reference object defines it' },
    };
  if (job.chunk === undefined)
    return {
      name: job.name,
      failure: { kind: 'missing-symbol', detail: 'the model has no function chunk at its entry' },
    };
  return undefined;
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
    if (c.kind === 'function') chunkAt.set(c.entry ?? c.span.start, i);
  });
  const labelByName = new Map<string, Label | null>();
  for (const l of model.labels) labelByName.set(l.name, labelByName.has(l.name) ? null : l);
  const names = new Map(model.functions.map((f) => [f.entry, f.name] as const));
  const dir = await mkdtemp(join(tmpdir(), 'romlift-objdiff-'));
  try {
    const refs = await references(inputs, tools, dir);
    const jobs = await jobsOf(
      agreeing.map(({ found: f, elf }) => ({ entry: f.entry, name: names.get(f.entry) ?? elf.name })),
      chunkAt,
      inputs,
      refs,
    );
    const out = new Map<number, ComparedFunction>();
    const groups = new Map<string, Job[]>();
    for (const job of jobs) {
      const refused = unpairable(job);
      if (refused !== undefined) out.set(job.n, refused);
      else if (job.object !== undefined) groups.set(job.object, [...(groups.get(job.object) ?? []), job]);
    }
    const cx: Context = { inputs, model, tools, dir, references: refs, labelByName };
    const ordered = [...groups.keys()]
      .sort(compareCodeUnits)
      .map((object): Group => ({ object, jobs: groups.get(object) ?? [] }));
    const results = await pooled(ordered, inputs.concurrency ?? availableParallelism(), (group) =>
      compareGroup(group, cx),
    );
    ordered.forEach((group, g) =>
      group.jobs.forEach((job, i) => {
        const c = results[g]?.[i];
        if (c !== undefined) out.set(job.n, c);
      }),
    );
    return jobs.map((job) => out.get(job.n) ?? { name: job.name, failure: { kind: 'tool', detail: 'not compared' } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The objdiff member of a ROM whose readable build linked. */
export async function scoreObjdiff(inputs: ObjdiffInputs): Promise<ObjdiffSummary> {
  return linkedSummary(objdiffVerdict(await compareFunctions(inputs), nameAddresses(inputs.symbols)));
}
