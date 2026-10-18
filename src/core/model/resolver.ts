// Names for addresses, per module (architecture §3.2, §5, §6.2, D62): the SymbolResolver the printer and
// the parser use, the module an address belongs to, and the word a `.4byte Name` links to. It lives in
// core/model because the printer (core/emit) and the re-encode and text-layout checks (core/verify, which
// may not import core/emit beyond tree.ts) both resolve labels the same way.
//
// Visibility: inside module M a label is visible when its scope is 'global' or it lies in M (the module
// whose run range, else load span, contains its address). So two modules may each have a module-scoped
// label of one name, as static functions do, and each resolves its own.
import type { SymbolResolver } from '../../foundation/isa/types.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { Label, LabelKind, Model, Module } from './types.ts';

/** The label printed when several share an address: a function name first, then table, pool, local, data. */
export const LABEL_KIND_ORDER: readonly LabelKind[] = ['func', 'table', 'pool', 'local', 'data'];

/** Orders labels by address, then preference (LABEL_KIND_ORDER), then name by code unit. */
export function compareLabels(a: Label, b: Label): number {
  return compareNumbers(a.addr, b.addr) || compareNumbers(LABEL_KIND_ORDER.indexOf(a.kind), LABEL_KIND_ORDER.indexOf(b.kind)) || compareCodeUnits(a.name, b.name);
}

/** The run range of a runs_at module, [runAt, runAt + length), or undefined. */
function runRange(m: Module): { readonly start: Addr; readonly end: Addr } | undefined {
  return m.runAt === undefined ? undefined : { start: m.runAt, end: m.runAt + (m.span.end - m.span.start) };
}

/**
 * The index in `modules` of the module `addr` belongs to: the runs_at module whose run range contains it,
 * else the module whose load span contains it; -1 for none. `modules` are in ROM order.
 */
export function moduleIndexAt(modules: readonly Module[], addr: Addr): number {
  for (const [i, m] of modules.entries()) {
    const run = runRange(m);
    if (run !== undefined && addr >= run.start && addr < run.end) return i;
  }
  let lo = 0;
  let hi = modules.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = modules[mid] as Module;
    if (addr < m.span.start) hi = mid - 1;
    else if (addr >= m.span.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The module `addr` belongs to (moduleIndexAt), or undefined. */
export function moduleAt(model: Pick<Model, 'modules'>, addr: Addr): Module | undefined {
  return model.modules[moduleIndexAt(model.modules, addr)];
}

/**
 * The value a `.4byte <label>` links to: the address plus one for a Thumb function (the linker sets the Thumb
 * bit of a Thumb `func` symbol), the address otherwise. A pool word prints as a name only when it equals this.
 */
export function wordValueOf(label: Pick<Label, 'addr' | 'kind' | 'thumb'>): number {
  return label.kind === 'func' && label.thumb ? (label.addr | 1) >>> 0 : label.addr >>> 0;
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
  const moduleOf = labels.map((l) => modules[moduleIndexAt(modules, l.addr)]?.name);
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

/** The first index in `labels` whose address is not below `addr`. */
function lowerBound(labels: readonly Label[], addr: Addr): number {
  let lo = 0;
  let hi = labels.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((labels[mid] as Label).addr < addr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function resolverFromIndex(index: LabelIndex, module: string): SymbolResolver {
  const visible = (i: number): boolean => index.labels[i]?.scope === 'global' || index.moduleOf[i] === module;
  return {
    // `from` does not matter in phase 3: every label visible in the module resolves the same anywhere in it.
    labelFor(target: Addr, _from: Addr): string | undefined {
      for (let i = lowerBound(index.labels, target); i < index.labels.length; i++) {
        const label = index.labels[i] as Label;
        if (label.addr !== target) break;
        if (visible(i)) return label.name;
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
 * resolverFor over labels and modules not yet in a Model (while buildModel assembles them), in any label
 * order. It indexes them afresh on every call and caches nothing, so the arrays may still grow afterwards.
 */
export function resolverOver(labels: readonly Label[], modules: readonly Module[], module: string): SymbolResolver {
  return resolverFromIndex(buildIndex(labels, modules), module);
}
