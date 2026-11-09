// Names for addresses, per module (architecture §3.2, §5, §6.2, D62): the SymbolResolver the printer and
// the parser use, the module an address belongs to, and the word a `.4byte Name` links to. It lives in
// core/model because the printer (core/emit) and the re-encode and text-layout checks (core/verify, which
// may not import core/emit beyond tree.ts) both resolve labels the same way.
//
// Visibility: inside module M a label is visible when its scope is 'global' or it lies in M (the module
// whose run range, else load span, contains its address). So two modules may each have a module-scoped
// label of one name, as static functions do, and each resolves its own.
//
// An `adr` (Thumb `add rd, pc, #`, ARM `adr`) names its target through adrResolverFor, which only names a label
// whose link value is the target itself (isExactLabel), never a Thumb function's, which links to its address plus
// one (the owner's answer to Q7 of phase 3, D72 c). The text-layout check resolves an adr's operand to that link
// value and refuses a Thumb adr of a Thumb function; GNU as encodes one at the even address under the dialect's
// `-mcpu=arm7tdmi`, but with `-mthumb-interwork` it adds 1 to an ARM adr of a Thumb function defined before it.
// A label whose value is the address itself assembles alike under every setting. labels.ts places a local label
// at an adr target that has only Thumb function labels.
//
// A runs_at module (§6.7, D46) links at its run address, so its labels name run addresses; a word that holds one of its
// load addresses (the copy's source: Klonoa's m4aSoundInit loads SoundMainRAM | 1, 0x0804F319, for its CpuCopy32) must
// never print as one of those labels, which would link to the run address. No label lies at a load address of a
// runs_at module, so such a word finds none and prints as its value; loadWordOperand names it through the ldscript's
// `__load_<module>` symbol (LOADADDR of the module's section) instead, which links to the same bytes.
import { abs32Word, type SymbolValue } from '../../foundation/asm/relocation.ts';
import type { SymbolResolver } from '../../foundation/isa/types.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { loadSymbolOf, moduleIndexAt, relocatedModules } from './modules.ts';
import type { Label, LabelKind, Model, ModelFunction, ModelSymbol, Module } from './types.ts';

/** The label printed when several share an address: a function name first, then table, pool, local, data. */
export const LABEL_KIND_ORDER: readonly LabelKind[] = ['func', 'table', 'pool', 'local', 'data'];

/** Each kind's place in LABEL_KIND_ORDER: the label printed first at a shared address has the lowest. */
const KIND_RANK: ReadonlyMap<LabelKind, number> = new Map(LABEL_KIND_ORDER.map((kind, i) => [kind, i] as const));

/** A label kind's place in LABEL_KIND_ORDER. */
function labelKindRank(kind: LabelKind): number {
  return KIND_RANK.get(kind) ?? LABEL_KIND_ORDER.length;
}

/** Orders labels by address, then preference (LABEL_KIND_ORDER), then name by code unit. */
export function compareLabels(a: Pick<Label, 'addr' | 'kind' | 'name'>, b: Pick<Label, 'addr' | 'kind' | 'name'>): number {
  return compareNumbers(a.addr, b.addr) || compareNumbers(labelKindRank(a.kind), labelKindRank(b.kind)) || compareCodeUnits(a.name, b.name);
}

/**
 * The module `addr` belongs to (moduleIndexAt), or undefined. For one address: it filters the relocated modules on
 * every call, so a caller asking for many addresses calls moduleIndexAt with relocatedModules computed once.
 */
export function moduleAt(model: Pick<Model, 'modules'>, addr: Addr): Module | undefined {
  return model.modules[moduleIndexAt(model.modules, addr, relocatedModules(model.modules))];
}

/**
 * The value a `.4byte <label>` links to: the address plus one for a Thumb function (the linker sets the Thumb
 * bit of a Thumb `func` symbol), the address otherwise. A pool word prints as a name only when it equals this.
 */
export function wordValueOf(label: Pick<Label, 'addr' | 'kind' | 'thumb'>): number {
  return linkedWordOf(label, 0);
}

/** What a label stands for in a relocation (foundation/asm/relocation.ts): its address, and T for a Thumb `func` label. */
export function symbolValueOf(label: Pick<Label, 'addr' | 'kind' | 'thumb'>): SymbolValue {
  return { addr: label.addr, thumbFunction: label.kind === 'func' && label.thumb };
}

/**
 * The value a `.4byte <label> + offset` links to: R_ARM_ABS32's (S + A) | T (abs32Word, the one rule the assembler
 * layout reads too), the Thumb bit T set for a Thumb function whatever the addend, so no addend makes a Thumb
 * function's name link to an even word.
 */
export function linkedWordOf(label: Pick<Label, 'addr' | 'kind' | 'thumb'>, offset: number): number {
  return abs32Word(symbolValueOf(label), offset);
}

/**
 * The addend with which `.4byte <label> + addend` links to `word` (linkedWordOf, R_ARM_ABS32's one rule), counted from
 * the word the label itself links to (wordValueOf), so a Thumb function names an odd word with addend 0; undefined when
 * no addend does, as for an even word at a Thumb function, whose name always links with the Thumb bit. The jump-table
 * printer (core/emit/print/table.ts) and the label scopes (labels.ts) read it, so they agree on the label an entry names.
 */
export function addendTo(label: Pick<Label, 'addr' | 'kind' | 'thumb'>, word: number): number | undefined {
  const addend = (word >>> 0) - wordValueOf(label);
  return linkedWordOf(label, addend) === word >>> 0 ? addend : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Named, sized entries: what a word inside one prints as (wordNameOf, read by core/emit/print/pool.ts wordText and the
// label scopes of labels.ts).

/**
 * A named entry with a size: a [symbols] entry with `size` or an inferred size (extents.ts, D110), or a function whose
 * extent is the TOML's `size`.
 */
export interface SizedEntry {
  readonly addr: Addr;
  readonly name: string;
  readonly size: number;
}

/** The model's named entries, for naming a word (sizedEntries). */
export interface SizedEntries {
  /** The sized entries by address, then name. */
  readonly sized: readonly SizedEntry[];
  /** maxEnd[i]: the largest end of sized[0..i], so a search for the entry holding a word stops early. */
  readonly maxEnd: readonly number[];
  /** `<addr>:<name>` of every named entry: every function, every [symbols] entry. */
  readonly named: ReadonlySet<string>;
}

const ENTRIES = new WeakMap<readonly ModelSymbol[], { readonly functions: readonly ModelFunction[]; readonly entries: SizedEntries }>();

function buildEntries(symbols: readonly ModelSymbol[], functions: readonly ModelFunction[]): SizedEntries {
  const sized: SizedEntry[] = [];
  const named = new Set<string>();
  for (const s of symbols) {
    named.add(`${String(s.addr)}:${s.name}`);
    const size = s.size ?? s.inferredSize;
    if (size !== undefined && size > 0) sized.push({ addr: s.addr, name: s.name, size });
  }
  for (const f of functions) {
    const at = f.runAt ?? f.entry;
    named.add(`${String(at)}:${f.name}`);
    if (f.source.extent === 'toml-size' && f.extent.end > f.extent.start) sized.push({ addr: at, name: f.name, size: f.extent.end - f.entry });
  }
  sized.sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
  const maxEnd: number[] = [];
  let reach = 0;
  for (const e of sized) maxEnd.push((reach = Math.max(reach, e.addr + e.size)));
  return { sized, maxEnd, named };
}

/** The named entries of a model, built once per model (cached by its symbols array, which a Model never changes). */
export function sizedEntries(model: Pick<Model, 'symbols' | 'functions'>): SizedEntries {
  const cached = ENTRIES.get(model.symbols);
  if (cached !== undefined && cached.functions === model.functions) return cached.entries;
  const entries = buildEntries(model.symbols, model.functions);
  ENTRIES.set(model.symbols, { functions: model.functions, entries });
  return entries;
}

/** Whether `label` is a named entry: a function's or a [symbols] entry's label at its own address. */
export function isNamedEntry(entries: SizedEntries, label: Pick<Label, 'addr' | 'name'>): boolean {
  return entries.named.has(`${String(label.addr)}:${label.name}`);
}

/**
 * The innermost sized entry `word` lies inside: start < word < start + size, `start` the word `.4byte <name>` links to
 * (the Thumb bit of a Thumb function counted by the caller, core/emit/print/pool.ts); undefined when none holds it.
 */
export function sizedEntryAt(entries: SizedEntries, word: number): SizedEntry | undefined {
  const { sized, maxEnd } = entries;
  for (let i = lowerBound(sized, word + 1, (e) => e.addr) - 1; i >= 0; i--) {
    if ((maxEnd[i] ?? 0) <= word) return undefined;
    const e = sized[i];
    if (e !== undefined && word > e.addr && word < e.addr + e.size) return e;
  }
  return undefined;
}

/**
 * A sized entry's own label, the one its `name + offset` names: the label named `entry.name` at `entry.addr` (the
 * entry's run address) that is not local, from `labelsAt` (the labels at a run address, preferred first). The one
 * lookup the three readers of wordNameOf pass as its `entryLabel` (pool.ts wordText and labels.ts' gUnk_ candidates and
 * label scopes), each over its own labels, so they cannot disagree on which label is the entry's (architecture-o0-5).
 */
export function entryLabelOf<L extends Pick<Label, 'name' | 'kind'>>(entry: SizedEntry, labelsAt: (addr: Addr) => readonly L[]): L | undefined {
  return labelsAt(entry.addr).find((l) => l.name === entry.name && l.kind !== 'local');
}

/** What a word names (wordNameOf): a label itself, or a sized entry's label with the offset from the word it links to. */
export type WordName<L> = { readonly kind: 'label'; readonly label: L } | { readonly kind: 'inside'; readonly label: L; readonly offset: number };

/**
 * What a word names (architecture §5 "Literal pools"), the one rule the printer (core/emit/print/pool.ts wordText) and
 * the label scopes (labels.ts) read. `exact` are the labels that link to exactly the word (wordValueOf), preferred
 * first: the first of them that is a named entry (a function, a [symbols] entry) names it; else the innermost sized
 * entry holding the word (sizedEntryAt) names it as `name + offset`, the offset from the word its label links to (what
 * the compiler emits for `&sym.field` or `&array[i]`: a relocation against the symbol with an addend), when
 * `entryLabel` (entryLabelOf over the caller's labels) gives that entry's label and `name + offset` links to the word (linkedWordOf: never an even word inside
 * a Thumb function, which the linker would write with the Thumb bit); else the first of `exact`; else nothing.
 */
export function wordNameOf<L extends Pick<Label, 'addr' | 'name' | 'kind' | 'thumb'>>(entries: SizedEntries, word: number, exact: readonly L[], entryLabel: (entry: SizedEntry) => L | undefined): WordName<L> | undefined {
  const named = exact.find((l) => isNamedEntry(entries, l));
  if (named !== undefined) return { kind: 'label', label: named };
  const entry = sizedEntryAt(entries, word);
  const label = entry === undefined ? undefined : entryLabel(entry);
  const offset = label === undefined ? 0 : word - wordValueOf(label);
  if (label !== undefined && offset > 0 && linkedWordOf(label, offset) === word) return { kind: 'inside', label, offset };
  const first = exact[0];
  return first === undefined ? undefined : { kind: 'label', label: first };
}

/** Whether `label` links to its own address (wordValueOf): every label but a Thumb function's, which carries the Thumb bit. */
export function isExactLabel(label: Pick<Label, 'addr' | 'kind' | 'thumb'>): boolean {
  return wordValueOf(label) === label.addr >>> 0;
}

// ---------------------------------------------------------------------------------------------------
// The label index, built once per (labels, modules) pair and shared by every module's resolver.

interface LabelIndex {
  /** Sorted by compareLabels. */
  readonly labels: readonly Label[];
  /** The module name of labels[i], or undefined when it lies in none. */
  readonly moduleOf: readonly (string | undefined)[];
  /** Name to indexes into `labels`, ascending. */
  readonly byName: ReadonlyMap<string, readonly number[]>;
}

const CACHE = new WeakMap<readonly Label[], { readonly modules: readonly Module[]; readonly index: LabelIndex }>();

function buildIndex(source: readonly Label[], modules: readonly Module[]): LabelIndex {
  const labels = [...source].sort(compareLabels);
  const relocated = relocatedModules(modules);
  const moduleOf = labels.map((l) => modules[moduleIndexAt(modules, l.addr, relocated)]?.name);
  const byName = new Map<string, number[]>();
  labels.forEach((l, i) => {
    const list = byName.get(l.name);
    if (list === undefined) byName.set(l.name, [i]);
    else list.push(i);
  });
  return { labels, moduleOf, byName };
}

function indexOf(labels: readonly Label[], modules: readonly Module[]): LabelIndex {
  const cached = CACHE.get(labels);
  if (cached !== undefined && cached.modules === modules) return cached.index;
  const index = buildIndex(labels, modules);
  CACHE.set(labels, { modules, index });
  return index;
}

/** The resolver of `module` over `index`; labelFor names only labels `names` accepts. */
function resolverFromIndex(index: LabelIndex, module: string, names: (label: Label) => boolean = () => true): SymbolResolver {
  const visible = (i: number): boolean => index.labels[i]?.scope === 'global' || index.moduleOf[i] === module;
  return {
    // `from` does not matter in phase 3: every label visible in the module resolves the same anywhere in it.
    labelFor(target: Addr, _from: Addr): string | undefined {
      for (let i = lowerBound(index.labels, target, (l) => l.addr); i < index.labels.length; i++) {
        const label = index.labels[i];
        if (label === undefined || label.addr !== target) break;
        if (visible(i) && names(label)) return label.name;
      }
      return undefined;
    },
    addressOf(name: string): Addr | undefined {
      const list = index.byName.get(name) ?? [];
      const own = list.find((i) => index.moduleOf[i] === module);
      const found = own ?? list.find((i) => index.labels[i]?.scope === 'global');
      return found === undefined ? undefined : index.labels[found]?.addr;
    },
  };
}

/**
 * The resolver of `module`: labelFor(target) is the preferred label at `target` (LABEL_KIND_ORDER, then
 * name) among those visible in the module; addressOf(name) is this module's label of that name first, then
 * a global one (the lowest address). The index is built once per model (cached by its labels array, which
 * a Model never changes) and shared by its modules.
 */
export function resolverFor(model: Pick<Model, 'labels' | 'modules'>, module: string): SymbolResolver {
  return resolverFromIndex(indexOf(model.labels, model.modules), module);
}

/**
 * The resolver of `module` for an `adr`: resolverFor, but labelFor(target) is the preferred visible label that links
 * to `target` itself (isExactLabel), never a Thumb function's, which links to `target` + 1 (see the header); undefined
 * when there is none, so the adr prints raw ('no-roundtrip').
 */
export function adrResolverFor(model: Pick<Model, 'labels' | 'modules'>, module: string): SymbolResolver {
  return resolverFromIndex(indexOf(model.labels, model.modules), module, isExactLabel);
}

/**
 * The operand of a `.4byte` holding `value` when it is a load address inside a runs_at module, the module's end
 * included (a copy's end): `__load_<module>`, plus the offset when there is one (`__load_ram_03000388 + 1` for a Thumb
 * pointer to its first byte). It links to `value` itself, wherever the module runs. Undefined for any other value.
 */
export function loadWordOperand(model: Pick<Model, 'modules'>, value: number): string | undefined {
  return loadOperandIn(relocatedModules(model.modules), value);
}

/** loadWordOperand over `relocated` (relocatedModules of the model's modules, computed once by the caller). */
export function loadOperandIn(relocated: readonly Pick<Module, 'name' | 'span'>[], value: number): string | undefined {
  const word = value >>> 0;
  for (const m of relocated) {
    if (word < m.span.start || word > m.span.end) continue;
    const offset = word - m.span.start;
    return offset === 0 ? loadSymbolOf(m) : `${loadSymbolOf(m)} + ${offset}`;
  }
  return undefined;
}
