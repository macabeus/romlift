// The `data` writer (architecture §6.3): data/<module>.s for every data module. Scope: module.
//
// The file is the dialect preamble, then the module's bytes from its start: a label at every label that
// lies in the module, every [symbols] entry inside it, every inner label of its chunks and the name of each
// data chunk; `.incbin "baserom.gba", 0xOFFSET, 0xLENGTH` slices of the ROM between them (OFFSET from
// 0x08000000); each table-entry item (a `type = "pointers"` symbol's words, as buildModel records them) as
// `.4byte Name` when a label visible in the module links to exactly its value (a Thumb function's name
// carries the Thumb bit, resolver.ts wordValueOf), else as the number; each padding item as `.align 2, 0`.
// A label is `.global` unless it is module-scoped and its name is shared with another label of the model
// (the static-function case of §6.2), where a second global definition would break the link; a Thumb
// function label is preceded by `.thumb_func`, so ld gives `.4byte Name` the Thumb bit wordValueOf promises.
import { DIALECT } from '../../../foundation/asm/dialect.ts';
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { ROM_BASE } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hex, hexAddr } from '../../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers } from '../../../foundation/util/sorted.ts';
import { lowerBound } from '../../../foundation/util/arrays.ts';
import { BASEROM_PATH, moduleSource } from '../../model/paths.ts';
import { moduleIndexAt, relocatedModules, runOffsetOf, runStartOf } from '../../model/modules.ts';
import { compareLabels, wordValueOf } from '../../model/resolver.ts';
import { ItemKind } from '../../model/types.ts';
import type { Label, Model, Module } from '../../model/types.ts';
import type { FileEntry, Writer } from '../tree.ts';

/** A label the file defines: its load address and name, whether it is `.global` and a Thumb function. */
interface Mark {
  readonly at: Addr;
  readonly name: string;
  readonly global: boolean;
  readonly thumbFunc: boolean;
}

function compareMarks(a: Mark, b: Mark): number {
  return compareNumbers(a.at, b.at) || compareCodeUnits(a.name, b.name);
}

/** How many labels of the model carry each name. */
function nameCounts(model: Model): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const l of model.labels) counts.set(l.name, (counts.get(l.name) ?? 0) + 1);
  return counts;
}

/** The first index of `labels` (sorted by address) whose address is not below `addr`. */
function firstLabelAt(labels: readonly { readonly addr: Addr }[], addr: Addr): number {
  return lowerBound(labels, addr, (l) => l.addr);
}

/** The module at `index`; the writer is called only with indexes of `model.modules`. */
function moduleOf(model: Model, index: number): Module {
  const module = model.modules[index];
  if (module === undefined) throw new RomliftInvariantError(`data writer: no module ${index} of ${model.modules.length}`);
  return module;
}

/** Every label the file of module `index` defines, by load address then name, one per name. */
function marksOf(model: Model, index: number): readonly Mark[] {
  const module = moduleOf(model, index);
  const offset = runOffsetOf(module);
  const run = { start: runStartOf(module), end: runStartOf(module) + (module.span.end - module.span.start) };
  const relocated = relocatedModules(model.modules);
  const counts = nameCounts(model);
  const out: Mark[] = [];
  const add = (runAddr: Addr, name: string, label: Label | undefined): void => {
    const shared = (counts.get(name) ?? 0) > (label === undefined ? 0 : 1);
    const thumbFunc = label !== undefined && wordValueOf(label) !== label.addr;
    out.push({ at: runAddr - offset, name, global: label?.scope === 'global' || !shared, thumbFunc });
  };
  for (let i = firstLabelAt(model.labels, run.start); i < model.labels.length; i++) {
    const l = model.labels[i];
    if (l === undefined || l.addr >= run.end) break;
    if (moduleIndexAt(model.modules, l.addr, relocated) === index) add(l.addr, l.name, l);
  }
  const chunks = model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count);
  for (const chunk of chunks) {
    for (const l of chunk.innerLabels) add(l.addr, l.name, l);
    if (chunk.kind === 'data') add(chunk.span.start + offset, chunk.name, undefined);
  }
  for (let i = firstLabelAt(model.symbols, run.start); i < model.symbols.length; i++) {
    const s = model.symbols[i];
    if (s === undefined || s.addr >= run.end) break;
    add(s.addr, s.name, undefined);
  }
  // One definition per name: a label of the model wins over a chunk name or a symbol of the same name.
  const seen = new Set<string>();
  const kept: Mark[] = [];
  for (const m of out) {
    if (seen.has(m.name) || m.at < module.span.start || m.at >= module.span.end) continue;
    seen.add(m.name);
    kept.push(m);
  }
  return kept.sort(compareMarks);
}

/** The name a `.4byte` of `word` prints in module `index`: a visible label linking to exactly that value, or a symbol. */
function wordName(model: Model, index: number, word: number, relocated: readonly Module[]): string | undefined {
  const target = (word & ~1) >>> 0;
  const own = model.modules[index]?.name;
  const at: Label[] = [];
  for (let i = firstLabelAt(model.labels, target); i < model.labels.length; i++) {
    const l = model.labels[i];
    if (l === undefined || l.addr !== target) break;
    at.push(l);
  }
  const label = at
    .sort(compareLabels)
    .find((l) => wordValueOf(l) === word && (l.scope === 'global' || model.modules[moduleIndexAt(model.modules, l.addr, relocated)]?.name === own));
  if (label !== undefined) return label.name;
  if (word !== target) return undefined;
  const symbol = model.symbols[firstLabelAt(model.symbols, target)];
  return symbol?.addr === target ? symbol.name : undefined;
}

function incbin(from: Addr, to: Addr): string {
  return `\t.incbin "${BASEROM_PATH}", 0x${hex(from - ROM_BASE, 1)}, 0x${hex(to - from, 1)}`;
}

/** The text of a data module's file. */
function dataText(model: Model, index: number): string {
  const module = moduleOf(model, index);
  const marks = marksOf(model, index);
  const relocated = relocatedModules(model.modules);
  const lines: string[] = [`@ data module ${module.name}: ${hexAddr(module.span.start)}..${hexAddr(module.span.end)}, ${module.span.end - module.span.start} bytes`];
  let next = 0;
  let pending = module.span.start;
  /** Writes the bytes [pending, to) as slices split at every label, and the labels up to `to` (inclusive). */
  const advance = (to: Addr, inclusive: boolean): void => {
    for (let m = marks[next]; m !== undefined && (m.at < to || (inclusive && m.at === to)); m = marks[++next]) {
      if (m.at > pending) lines.push(incbin(pending, m.at));
      pending = Math.max(pending, m.at);
      lines.push('', ...(m.global ? [`\t.global ${m.name}`] : []), ...(m.thumbFunc ? ['\t.thumb_func'] : []), `${m.name}: @ ${hexAddr(m.at + runOffsetOf(module))}`);
    }
    if (to > pending) lines.push(incbin(pending, to));
    pending = Math.max(pending, to);
  };
  const markInside = (start: Addr, end: Addr): boolean => {
    for (let k = next; k < marks.length; k++) {
      const at = marks[k]?.at ?? end;
      if (at >= end) return false;
      if (at > start) return true;
    }
    return false;
  };
  const items = model.items;
  for (const chunk of model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count)) {
    const last = Math.min(chunk.items.first + chunk.items.count, items.count);
    for (let i = chunk.items.first; i < last; i++) {
      const start = items.start[i] ?? 0;
      const end = start + (items.length[i] ?? 0);
      const kind = items.kind[i];
      const table = kind === ItemKind.tableEntry && end - start === 4;
      const padding = kind === ItemKind.padding && start % 4 !== 0 && end % 4 === 0;
      if ((!table && !padding) || markInside(start, end)) continue;
      advance(start, true);
      if (table) {
        const word = items.aux[i] ?? 0;
        lines.push(`\t.4byte ${wordName(model, index, word, relocated) ?? `0x${hex(word)}`}`);
      } else {
        lines.push('\t.align 2, 0');
      }
      pending = end;
    }
  }
  advance(module.span.end, false);
  return `${DIALECT.preamble('thumb')}\n${lines.join('\n')}\n`;
}

export const dataWriter: Writer = {
  id: 'data',
  scope: 'module',
  emit(_rom: Rom, model: Model, _cx, module: number | null): Iterable<FileEntry> {
    const m = module === null ? undefined : model.modules[module];
    if (module === null || m === undefined || m.kind !== 'data') return [];
    const path = moduleSource(model, m);
    if (!path.startsWith('data/')) return [];
    return [{ ownership: 'generated', path, text: dataText(model, module), writer: 'data' }];
  },
};
