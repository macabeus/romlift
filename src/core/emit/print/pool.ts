// Literal pools (architecture §5 "Literal pools"): what a 32-bit word prints as. A value prints as a name
// only when the linker writes the same word for `.4byte Name` (resolver.ts wordValueOf): an odd value equal
// to a Thumb function's address plus one prints that function; an even value equal to a Thumb function's
// address stays numeric (the linker would set the Thumb bit); a value equal to an ARM function, a table, a
// pool or a data label prints that name, and so does a RAM, I/O or absolute address the config's [symbols]
// names (a global label symbols.ld defines). A local label (a branch target) never names a word, and a label
// is a candidate only where the module can see it (global, or lying in the module).
//
// A word inside a named, sized entry (a [symbols] entry with a `size`, or a [functions] entry whose extent is the
// TOML's `size`) prints as `name + offset`, the offset from the word `.4byte name` links to, unless a named entry (a
// function, or a [symbols] entry) links to exactly the word: what the compiler emits for `&sym.field` or `&array[i]`,
// a relocation against the symbol with an addend (resolver.ts wordNameOf, the one rule; labels.ts makes the entry's
// label global when the word lies in another module, so the entry is always visible here). A load address of a runs_at
// module (§6.7), its end included, prints `__load_<module>` plus its offset (resolver.ts loadOperandIn), which the
// ldscript defines: the copy's source, never the label that links to its run address. Anything else prints
// `0xXXXXXXXX`.
//
// Every helper takes a WordScope, made once per chunk for its module (correctness-r0-5): the relocated modules and
// the sized entries are computed once, not per word.
import type { Addr } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';
import { lowerBound } from '../../../foundation/util/arrays.ts';
import { moduleIndexAt, relocatedModules } from '../../model/modules.ts';
import { compareLabels, loadOperandIn, sizedEntries, wordNameOf, wordValueOf, type SizedEntries, type SizedEntry } from '../../model/resolver.ts';
import type { Label, Model, Module } from '../../model/types.ts';

/** What naming a word inside one module reads: the model's labels and modules, computed once for the module. */
export interface WordScope {
  readonly labels: readonly Label[];
  readonly modules: readonly Module[];
  /** The module the word is printed in. */
  readonly module: string;
  /** relocatedModules(modules), once. */
  readonly relocated: readonly Module[];
  /** The named, sized entries and the named entries (resolver.ts sizedEntries, cached per model). */
  readonly entries: SizedEntries;
}

/** The WordScope of `module`. */
export function wordScope(model: Pick<Model, 'labels' | 'modules' | 'symbols' | 'functions'>, module: string): WordScope {
  return { labels: model.labels, modules: model.modules, module, relocated: relocatedModules(model.modules), entries: sizedEntries(model) };
}

/** The labels at run address `addr` that the scope's module can see, preferred first (compareLabels). */
export function visibleLabelsAt(scope: WordScope, addr: Addr): readonly Label[] {
  const labels = scope.labels;
  const out: Label[] = [];
  for (let i = lowerBound(labels, addr, (l) => l.addr); i < labels.length; i++) {
    const l = labels[i];
    if (l === undefined || l.addr !== addr) break;
    out.push(l);
  }
  if (out.length === 0) return out;
  const own = scope.modules[moduleIndexAt(scope.modules, addr, scope.relocated)]?.name === scope.module;
  return out.filter((l) => l.scope === 'global' || own).sort(compareLabels);
}

/** The labels `.4byte <name>` of which links to exactly `value`, visible in the scope's module, preferred first. */
function exactLabels(scope: WordScope, value: number): readonly Label[] {
  const word = value >>> 0;
  const candidates = (word & 1) === 1 ? [...visibleLabelsAt(scope, word - 1), ...visibleLabelsAt(scope, word)] : visibleLabelsAt(scope, word);
  return candidates.filter((l) => l.kind !== 'local' && wordValueOf(l) === word);
}

/** The label `.4byte <name>` of which links to exactly `value`, visible in the scope's module, or undefined. */
export function labelForWord(scope: WordScope, value: number): Label | undefined {
  return exactLabels(scope, value)[0];
}

/**
 * The operand of a `.4byte` holding `value`: a label's name or `name + offset` under the rule above (resolver.ts
 * wordNameOf), else a runs_at module's `__load_<module> + offset`, else `0xXXXXXXXX`.
 */
export function wordText(scope: WordScope, value: number): string {
  const word = value >>> 0;
  const entryLabel = (entry: SizedEntry): Label | undefined => visibleLabelsAt(scope, entry.addr).find((l) => l.name === entry.name && l.kind !== 'local');
  const named = wordNameOf(scope.entries, word, exactLabels(scope, word), entryLabel);
  if (named?.kind === 'inside') return `${named.label.name} + ${named.offset}`;
  return named?.label.name ?? loadOperandIn(scope.relocated, word) ?? `0x${hex(word)}`;
}

/** A pool word's line: its labels on the same line, `_08001A3C: .4byte gFoo`. */
export function poolLine(labels: readonly string[], operand: string): string {
  return labels.length === 0 ? `\t.4byte ${operand}` : `${labels.map((n) => `${n}:`).join(' ')} .4byte ${operand}`;
}

/** The comment a PC-relative load carries: `@ =<what the pool word prints as>`. */
export function poolLoadComment(operand: string): string {
  return `@ =${operand}`;
}
