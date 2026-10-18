// The model's items (architecture §6.2 step 1, §9.4, D14, D15, D19): every ROM byte in exactly one item.
//
// The analysis says what each byte is (segments.ts segmentsOf): instructions from FunctionFact.code (the code spans of one
// mode merged first, so a bl pair is never split between two functions' readings), pool words from `pools`
// and `farPools`, table entries from the jump tables, padding (zeros up to a word boundary) and data from the
// region rules' claims. Where two facts overlap, the earlier start wins, then code over pools, tables,
// padding and data. Inside a code chunk, the free zero bytes from a non-word address up to a pool word or
// table entry at the next word boundary are padding too (D16: zero bytes up to a word boundary print as
// `.align 2, 0`; agbcc's `.align 2, 0` before a literal pool, which no walk reaches). Every other byte is
// data, noted `dead` (claim.dead-code-in-extent), `mixer-hole` (a hole kept inside an extent) or `unreached`
// (any other byte inside an extent); the header and data chunks carry no notes, and data items are split
// only at labels, so a data module is a few large items.
//
// An instruction is an `insn` item when it prints as a mnemonic: its text, parsed and assembled at its run
// address with the labels its module sees, gives back its bytes (foundation/isa roundtrip). Otherwise it is a
// `raw-insn` with the reason; a short Thumb branch into another module is raw with
// 'cross-module-short-branch' and W_CROSS_MODULE_SHORT_BRANCH (D15; architecture §12 item 3's safe default).
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { decode } from '../../foundation/isa/decode.ts';
import { specOf } from '../../foundation/isa/rows.ts';
import type { Insn, SymbolResolver } from '../../foundation/isa/types.ts';
import { peek16, peek32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import type { ChunkPlan } from './chunks.ts';
import type { CodeRef } from './labels.ts';
import { ModelCodes } from './codes.ts';
import { itemTableBuilder } from './item-table.ts';
import { printingCache } from './printing-cache.ts';
import { relocatedModules, runModuleAt } from './modules.ts';
import { resolverFor } from './resolver.ts';
import type { DataNote, ItemRawReason, ItemTable, Label, Module } from './types.ts';
import type { Segment, Segments } from './segments.ts';

// ---------------------------------------------------------------------------------------------------
// Items per chunk.

export interface ItemsInputs {
  readonly rom: Rom;
  /** In address order, tiling the ROM. */
  readonly chunks: readonly ChunkPlan[];
  /** In ROM order; chunk.module indexes it. */
  readonly modules: readonly Module[];
  readonly segments: Segments;
  /** Every label of the model (run addresses). */
  readonly labels: readonly Label[];
  /** The load addresses of the labels, ascending and unique: data items are split there. */
  readonly labelStarts: readonly Addr[];
  /** The load-to-run offset of each chunk (0 outside runs_at). */
  readonly runOffsets: readonly number[];
  /** The references of the code (labels.ts codeRefs), by site: their instructions need no second decode. */
  readonly refs: readonly CodeRef[];
}

export interface ItemsResult {
  readonly items: ItemTable;
  /** Per chunk: its items. */
  readonly ranges: readonly { readonly first: number; readonly count: number }[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The index of the first element of `list`, from `at` on, whose end is above `a`. */
function firstEndingAbove(list: readonly { readonly end: Addr }[], at: number, a: Addr): number {
  let i = at;
  while (i < list.length && (list[i]?.end ?? Infinity) <= a) i++;
  return i;
}

/** The index of the first value above `a` in an ascending list of integers. */
function firstAbove(sorted: readonly Addr[], a: Addr): number {
  return lowerBound(sorted, a + 1, (x) => x);
}

/** The items of every chunk, in address order, with the chunks' item ranges. */
export function buildItems(inputs: ItemsInputs): ItemsResult {
  const { rom, segments, labelStarts } = inputs;
  // Room for every item up front: one per code halfword at most, one per other segment, two per chunk for data.
  const capacity = segments.concrete.reduce((n, s) => n + (s.kind === 'code' ? (s.end - s.start) >>> 1 : 1), 2 * inputs.chunks.length);
  const table = itemTableBuilder(Math.max(1024, capacity));
  const diagnostics: Diagnostic[] = [];
  const ranges: { first: number; count: number }[] = [];
  const cache = printingCache();
  const relocated = relocatedModules(inputs.modules);
  const resolvers = inputs.modules.map((m) => resolverFor({ labels: inputs.labels, modules: inputs.modules }, m.name));
  // Forward positions in the sorted lists: every address asked below is at or above the previous one.
  let segmentAt = 0;
  let noteAt = 0;
  let extentAt = 0;
  let refAt = 0;

  /** Data over [a, b), split at labels; with notes when `noted`. */
  const fillData = (a: Addr, b: Addr, noted: boolean): void => {
    let at = a;
    let label = firstAbove(labelStarts, at);
    while (at < b) {
      let stop = b;
      const nextLabel = labelStarts[label];
      if (nextLabel !== undefined && nextLabel < stop) stop = nextLabel;
      let note: DataNote | undefined;
      if (noted) {
        noteAt = firstEndingAbove(segments.notes, noteAt, at);
        extentAt = firstEndingAbove(segments.extents, extentAt, at);
        const ns = segments.notes[noteAt];
        const xs = segments.extents[extentAt];
        if (ns !== undefined && ns.start <= at) {
          note = ns.note;
          stop = Math.min(stop, ns.end);
        } else {
          if (ns !== undefined) stop = Math.min(stop, ns.start);
          if (xs !== undefined && xs.start <= at) {
            note = 'unreached';
            stop = Math.min(stop, xs.end);
          } else if (xs !== undefined) {
            stop = Math.min(stop, xs.start);
          }
        }
      }
      table.append(note === undefined ? { kind: 'data', start: at, length: stop - at } : { kind: 'data', start: at, length: stop - at, note });
      at = stop;
      while ((labelStarts[label] ?? Infinity) <= at) label++;
    }
  };

  /** The instructions of [a, b) in `mode`, in chunk `c`. */
  const fillCode = (a: Addr, b: Addr, mode: Mode, c: ChunkPlan, offset: number): void => {
    const resolver = resolvers[c.module];
    if (resolver === undefined) throw new RomliftInvariantError(`model: chunk ${c.name} names module ${c.module} of ${inputs.modules.length}`);
    let at = a;
    while (at < b) {
      const room = b - at;
      if (room < (mode === 'thumb' ? 2 : 4)) {
        fillData(at, b, false);
        return;
      }
      const word = mode === 'thumb' ? peek16(rom, at) : peek32(rom, at);
      const known = cache.known(mode, word);
      if (known !== undefined) {
        const length = mode === 'thumb' ? 2 : 4;
        if (known.reason === null) table.append({ kind: 'insn', start: at, length, specId: known.specId });
        else table.append({ kind: 'raw-insn', start: at, length, specId: known.specId, reason: known.reason });
        at += length;
        continue;
      }
      const run = at + offset;
      while (refAt < inputs.refs.length && (inputs.refs[refAt]?.site ?? Infinity) < at) refAt++;
      const ref = inputs.refs[refAt];
      if (ref !== undefined && ref.site === at && ref.run === run && ref.size <= room && specOf(ref.specId).raw === undefined) {
        const reason = refReason(ref, mode, c, resolver);
        if (reason === null) table.append({ kind: 'insn', start: at, length: ref.size, specId: ref.specId });
        else table.append({ kind: 'raw-insn', start: at, length: ref.size, specId: ref.specId, reason });
        at += ref.size;
        continue;
      }
      let insn = decode(mode, mode === 'thumb' ? (room >= 4 ? peek32(rom, at) : word) : word, run);
      if (insn.size > room) insn = decode('thumb', word, run);
      const length = insn.size;
      const reason = itemReason(insn, c, resolver);
      if (reason === null) table.append({ kind: 'insn', start: at, length, specId: insn.specId });
      else table.append({ kind: 'raw-insn', start: at, length, specId: insn.specId, reason });
      at += length;
    }
  };

  /** Whether a short branch at `site` to `target` leaves chunk `c`'s module; W_CROSS_MODULE_SHORT_BRANCH when it does. */
  const crossesModule = (site: Addr, target: Addr, c: ChunkPlan): boolean => {
    const module = runModuleAt(inputs.modules, relocated, target);
    if (module < 0 || module === c.module) return false;
    diagnostics.push(
      diagnostic(ModelCodes, 'W_CROSS_MODULE_SHORT_BRANCH', `the branch at ${hexAddr(site)} reaches ${hexAddr(target)} in module ${inputs.modules[module]?.name ?? ''} from module ${inputs.modules[c.module]?.name ?? ''}; it prints raw`, {
        addr: site,
        cites: [target],
      }),
    );
    return true;
  };

  const itemReason = (insn: Insn, c: ChunkPlan, resolver: SymbolResolver): ItemRawReason | null => {
    const encoding = specOf(insn.specId).raw?.(insn.fields) ?? null;
    if (encoding !== null) return encoding;
    if (insn.mode === 'thumb' && insn.size === 2 && insn.flow.kind === 'branch' && crossesModule(insn.addr, insn.flow.target, c)) return 'cross-module-short-branch';
    return cache.reasonOf(insn, resolver);
  };

  /** itemReason for an instruction codeRefs decoded already (its row has no encoding reason). */
  const refReason = (ref: CodeRef, mode: Mode, c: ChunkPlan, resolver: SymbolResolver): ItemRawReason | null => {
    if (ref.kind === 'short-branch' && crossesModule(ref.run, ref.target, c)) return 'cross-module-short-branch';
    return cache.reasonOfNaming(mode, ref.specId, ref.word, ref.run, ref.target, resolver, () => decode(mode, ref.word, ref.run));
  };

  /**
   * Whether the free bytes [a, b) of a code chunk are the zeros up to a word boundary before the pool word or
   * table entry `s` (D16), with no label inside them: they are then a padding item, printed `.align 2, 0`.
   */
  const alignsTo = (a: Addr, b: Addr, s: Segment): boolean => {
    if ((s.kind !== 'pool' && s.kind !== 'table') || s.start !== b || b % 4 !== 0 || b - a >= 4) return false;
    for (let at = a; at < b; at++) if (rom.bytes[at - rom.base] !== 0) return false;
    const label = labelStarts[firstAbove(labelStarts, a)];
    return label === undefined || label >= b;
  };

  /** One concrete segment clipped to [a, b). */
  const fillSegment = (s: Segment, a: Addr, b: Addr, c: ChunkPlan, offset: number): void => {
    const whole = a === s.start && b === s.end;
    switch (s.kind) {
      case 'code':
        fillCode(a, b, s.mode, c, offset);
        return;
      case 'pool':
        if (whole) table.append({ kind: 'pool', start: a, value: s.value });
        else fillData(a, b, false);
        return;
      case 'table':
        if (whole) table.append({ kind: 'table-entry', start: a, target: s.target, thumbBit: s.thumbBit });
        else fillData(a, b, false);
        return;
      case 'padding':
        if (whole) table.append({ kind: 'padding', start: a, length: b - a });
        else fillData(a, b, false);
        return;
      case 'data':
        fillData(a, b, false);
        return;
    }
  };

  inputs.chunks.forEach((c, i) => {
    const first = table.count;
    const { start, end } = c.span;
    const offset = inputs.runOffsets[i] ?? 0;
    if (c.kind === 'data') {
      fillData(start, end, false);
    } else {
      const noted = c.kind !== 'header';
      let at = start;
      segmentAt = firstEndingAbove(segments.concrete, segmentAt, start);
      for (let k = segmentAt; k < segments.concrete.length; k++) {
        const s = segments.concrete[k];
        if (s === undefined || s.start >= end) break;
        const a = Math.max(s.start, start);
        if (a > at && noted && alignsTo(at, a, s)) table.append({ kind: 'padding', start: at, length: a - at });
        else if (a > at) fillData(at, a, noted);
        const b = Math.min(s.end, end);
        fillSegment(s, a, b, c, offset);
        at = b;
      }
      if (at < end) fillData(at, end, noted);
    }
    ranges.push({ first, count: table.count - first });
  });
  return { items: table.finish(), ranges, diagnostics };
}
