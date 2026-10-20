// One chunk as assembly text (architecture §5 "Printing beyond one instruction", §6.3, D14, D16, D62): the
// lines a chunk's file holds (function and orphan chunks) or its module's file inlines (header, startup and
// data chunks), and the statistics the readability family sums.
//
// Every chunk opens with `.thumb` or `.arm`, so no file depends on the state an earlier include left. A
// function or startup chunk opens with its start macro: `arm_func_start` for ARM, `thumb_func_start` for
// Thumb, `non_word_aligned_thumb_func_start` for a Thumb entry at 2 mod 4, each in its `_local` variant when
// the function's label is module-scoped (§6.2); it ends with `arm_func_end`/`thumb_func_end`. An orphan
// prints `@ bytes between functions`, a global `unk_` label and its bytes; the header prints the PoC's
// `.byte` lines under a global label.
//
// The readable printer places every label of the model and every inner label at its address (`.global`
// for a global one; `.type`/`.thumb_func` for an inner function label, so `.4byte Name` links as the model
// says), switches state when an instruction's mode changes (the ARM code after `bx pc`), and prints each
// item with print/{insn,pool,table,data}.ts. A label inside a data item splits it; one inside any other item
// cannot be placed and is left out (the model never puts one there; the text-layout check would see it).
// The raw printer keeps the same chunk openings and closings and prints the body with printRawRange.
//
// A function chunk that folded the zero pad before its entry (core/model/chunks.ts) opens with its padding item:
// both printers leave it to the start macro, whose `.align 2, 0` emits it, and put the chunk's label and macro at
// the entry. Should a label lie inside the pad (the model then holds it as data), the pad's items are printed
// before the start macro instead, whose alignment then emits nothing.
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { contains, u32, u8 } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import { lowerBound, pushAll } from '../../../foundation/util/arrays.ts';
import { hex } from '../../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../../foundation/util/sorted.ts';
import { chunkEntry } from '../../model/chunks.ts';
import { itemAt } from '../../model/item-table.ts';
import { runOffsetOf } from '../../model/modules.ts';
import { adrResolverFor, compareLabels, resolverFor } from '../../model/resolver.ts';
import { ItemKind } from '../../model/types.ts';
import type { Chunk, Item, Label, Model } from '../../model/types.ts';
import { DEFAULT_PRINTER, emptyPrintStats } from '../tree.ts';
import type { EmitContext, PrintedChunk, Printer, PrintStats } from '../tree.ts';
import { noteLines, paddingLines } from './data.ts';
import type { InsnContext, PrintedInsn } from './insn.ts';
import { printInsn, printRawInsn, printUndecodedInsn } from './insn.ts';
import { poolLine, wordText } from './pool.ts';
import { printRawRange } from './raw.ts';
import type { RawLabel } from './raw.ts';
import { tableEntryLine } from './table.ts';

/** The rawReasons key of an instruction the raw printer emitted as data although it has a mnemonic. */
const RAW_PRINTER_REASON = 'raw-printer';

/** The bytes of the cartridge header the header chunk prints per `.byte` line, as the PoC. */
const HEADER_BYTES_PER_LINE = 16;

// ---------------------------------------------------------------------------------------------------
// Statistics.

interface StatsCounter {
  insns: number;
  rawInsns: number;
  branches: number;
  symbolicBranches: number;
  poolLoads: number;
  symbolicPoolLoads: number;
  readonly rawReasons: Map<string, number>;
}

function counter(): StatsCounter {
  return { insns: 0, rawInsns: 0, branches: 0, symbolicBranches: 0, poolLoads: 0, symbolicPoolLoads: 0, rawReasons: new Map() };
}

function count(stats: StatsCounter, printed: { readonly rawReason?: string; readonly branch: boolean; readonly poolLoad: boolean }): void {
  stats.insns += 1;
  const symbolic = printed.rawReason === undefined;
  if (!symbolic) {
    stats.rawInsns += 1;
    stats.rawReasons.set(printed.rawReason, (stats.rawReasons.get(printed.rawReason) ?? 0) + 1);
  }
  if (printed.branch) {
    stats.branches += 1;
    if (symbolic) stats.symbolicBranches += 1;
  }
  if (printed.poolLoad) {
    stats.poolLoads += 1;
    if (symbolic) stats.symbolicPoolLoads += 1;
  }
}

function finish(stats: StatsCounter): PrintStats {
  if (stats.insns === 0) return emptyPrintStats();
  const reasons: Record<string, number> = {};
  for (const [key, n] of sortedEntries(stats.rawReasons)) reasons[key] = n;
  return { ...stats, rawReasons: reasons };
}

// ---------------------------------------------------------------------------------------------------
// Labels.

/** Every label placed inside the chunk: the model's labels in its run range and its inner labels, once each, in address order. */
function chunkLabels(model: Model, chunk: Chunk, runOffset: number): readonly Label[] {
  const start = chunk.span.start + runOffset;
  const end = chunk.span.end + runOffset;
  const out: Label[] = [];
  const seen = new Set<string>();
  const add = (l: Label): void => {
    const key = `${String(l.addr)}:${l.name}`;
    if (l.addr < start || l.addr >= end || seen.has(key)) return;
    seen.add(key);
    out.push(l);
  };
  for (let i = lowerBound(model.labels, start, (l) => l.addr); i < model.labels.length; i++) {
    const l = model.labels[i];
    if (l === undefined || l.addr >= end) break;
    add(l);
  }
  for (const l of chunk.innerLabels) add(l);
  return out.sort(compareLabels);
}

/** The chunk's own label: the label named like the chunk at its entry (run address `at`), if the model has one. */
function headLabel(labels: readonly Label[], chunk: Chunk, at: Addr): Label | undefined {
  return labels.find((l) => l.addr === at && l.name === chunk.name);
}

/** The lines that define `label` at the current address in state `mode`. */
function labelLines(label: Label, mode: Mode): readonly string[] {
  const out: string[] = [];
  if (label.scope === 'global') out.push(`.global ${label.name}`);
  if (label.kind === 'func') {
    out.push(`.type ${label.name}, %function`);
    if (label.thumb && mode === 'thumb') out.push('.thumb_func');
  }
  out.push(`${label.name}:`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Openings and closings.

function modeOf(chunk: Chunk): Mode {
  return chunk.mode ?? 'thumb';
}

function hasStartMacro(chunk: Chunk): boolean {
  return chunk.kind === 'function' || chunk.kind === 'startup';
}

/** The start macro of a function or startup chunk (dialect.ts defines them). */
export function startMacro(mode: Mode, start: Addr, local: boolean): string {
  const base = mode === 'arm' ? 'arm_func_start' : (start & 3) === 2 ? 'non_word_aligned_thumb_func_start' : 'thumb_func_start';
  return local ? `${base}_local` : base;
}

/** The end macro of a function or startup chunk. */
export function endMacro(mode: Mode): string {
  return mode === 'arm' ? 'arm_func_end' : 'thumb_func_end';
}

/**
 * The lines before the body: the state, the lines of a folded pad the start macro does not emit (`prelude`), the
 * macro or comment, and the chunk's own label at run address `at` (its entry).
 */
function opening(chunk: Chunk, head: Label | undefined, at: Addr, prelude: readonly string[]): readonly string[] {
  const mode = modeOf(chunk);
  const out: string[] = [`.${mode}`];
  pushAll(out, prelude);
  switch (chunk.kind) {
    case 'function':
    case 'startup':
      out.push(`\t${startMacro(mode, at, head?.scope === 'module')} ${chunk.name}`, `${chunk.name}: @ ${hex(at)}`);
      break;
    case 'orphan':
      out.push(`@ bytes between functions: ${chunk.span.end - chunk.span.start} bytes`, `.global ${chunk.name}`, `${chunk.name}: @ ${hex(at)}`);
      break;
    case 'header':
      out.push('@ GBA cartridge header', `.global ${chunk.name}`, `${chunk.name}:`);
      break;
    case 'data':
      if (head?.scope !== 'module') out.push(`.global ${chunk.name}`);
      out.push(`${chunk.name}: @ ${hex(at)}`);
      break;
  }
  return out;
}

function closing(chunk: Chunk): readonly string[] {
  return hasStartMacro(chunk) ? [`\t${endMacro(modeOf(chunk))} ${chunk.name}`] : [];
}

// ---------------------------------------------------------------------------------------------------
// Bodies.

interface BodyContext {
  readonly rom: Rom;
  readonly model: Model;
  readonly chunk: Chunk;
  readonly runOffset: number;
  /** Labels placed in the body (the chunk's own label excluded), in address order. */
  readonly labels: readonly Label[];
  readonly stats: StatsCounter;
}

/** Splits [start, end) at the load addresses of the labels strictly inside it. */
function splitAt(span: Span, cuts: readonly Addr[]): readonly Span[] {
  const out: Span[] = [];
  let at = span.start;
  for (const cut of cuts) {
    if (cut <= at || cut >= span.end) continue;
    out.push({ start: at, end: cut });
    at = cut;
  }
  out.push({ start: at, end: span.end });
  return out;
}

/** The header's bytes, 16 to a `.byte` line, cut at labels. */
function headerBody(cx: BodyContext): readonly string[] {
  const out: string[] = [];
  const { rom, chunk, labels, runOffset } = cx;
  let next = 0;
  const pieces = splitAt(
    chunk.span,
    labels.map((l) => l.addr - runOffset),
  );
  for (const piece of pieces) {
    for (let l = labels[next]; l !== undefined && l.addr - runOffset <= piece.start; l = labels[++next]) {
      if (l.addr - runOffset === piece.start) pushAll(out, labelLines(l, 'thumb'));
    }
    for (let a = piece.start; a < piece.end; a += HEADER_BYTES_PER_LINE) {
      const bytes: string[] = [];
      for (let b = a; b < Math.min(a + HEADER_BYTES_PER_LINE, piece.end); b++) bytes.push(`0x${hex(u8(rom, b), 2)}`);
      out.push(`\t.byte ${bytes.join(', ')}`);
    }
  }
  return out;
}

function insnContext(cx: BodyContext): InsnContext {
  const { rom, model, chunk, runOffset } = cx;
  return {
    resolver: resolverFor(model, chunk.module),
    adrResolver: adrResolverFor(model, chunk.module),
    poolOperand(addr: Addr): string | undefined {
      const load = addr - runOffset;
      return contains(rom, load, 4) && (load & 3) === 0 ? wordText(model, chunk.module, u32(rom, load)) : undefined;
    },
  };
}

function printCode(rom: Rom, item: Item, mode: Mode, icx: InsnContext): PrintedInsn | undefined {
  if (item.kind === 'insn') return printInsn(item.insn, icx);
  if (item.kind === 'raw-insn') return item.insn === undefined ? printUndecodedInsn(rom, item.span, mode, item.reason) : printRawInsn(item.insn, item.reason);
  return undefined;
}

/** The readable lines of items [first, end) of the chunk: `labels` (theirs, in address order) at their addresses, state switches, and each item. */
function readableItems(cx: BodyContext, first: number, end: number, labels: readonly Label[]): readonly string[] {
  const { rom, model, chunk, runOffset, stats } = cx;
  const out: string[] = [];
  const icx = insnContext(cx);
  let mode = modeOf(chunk);
  let next = 0;
  const labelsBefore = (load: Addr): readonly Label[] => {
    const at: Label[] = [];
    for (let l = labels[next]; l !== undefined && l.addr - runOffset <= load; l = labels[++next]) {
      if (l.addr - runOffset === load) at.push(l);
    }
    return at;
  };
  for (let i = first; i < end; i++) {
    const item = itemAt(model.items, i, rom, runOffset);
    const printed = printCode(rom, item, mode, icx);
    if (printed !== undefined && printed.mode !== mode) {
      mode = printed.mode;
      out.push(`.${mode}`);
    }
    const here = labelsBefore(item.span.start);
    if (item.kind === 'pool') {
      for (const l of here) pushAll(out, labelLines(l, mode).slice(0, -1));
      out.push(poolLine(here.map((l) => l.name), wordText(model, chunk.module, item.value)));
      continue;
    }
    for (const l of here) pushAll(out, labelLines(l, mode));
    if (printed !== undefined) {
      out.push(printed.line);
      count(stats, printed);
      continue;
    }
    switch (item.kind) {
      case 'table-entry':
        out.push(tableEntryLine(model, chunk.module, item.target, item.thumbBit));
        break;
      case 'padding':
        pushAll(out, paddingLines(rom, item.span));
        break;
      case 'data': {
        const inner = labels.slice(next).map((l) => l.addr - runOffset).filter((a) => a > item.span.start && a < item.span.end);
        for (const piece of splitAt(item.span, inner)) {
          for (const l of labelsBefore(piece.start)) pushAll(out, labelLines(l, mode));
          pushAll(out, noteLines(rom, piece, item.note));
        }
        break;
      }
    }
  }
  return out;
}

/**
 * The raw lines of items [first, end) of the chunk, over the load range `span` they cover: printRawRange with the
 * inner labels and the global labels among `labels` placed (one per address, an inner label first), each global
 * one declared `.global` before the lines. printRawRange leaves a label at the range's start to its caller; with
 * `labelAtStart` it is printed here, as printRawRange prints the others.
 */
function rawItems(cx: BodyContext, first: number, end: number, span: Span, labels: readonly Label[], labelAtStart: boolean): readonly string[] {
  const { rom, model, chunk, runOffset, stats } = cx;
  const words = new Set<Addr>();
  for (let i = first; i < end; i++) {
    const kind = model.items.kind[i];
    const start = model.items.start[i] ?? 0;
    if (kind === ItemKind.pool || kind === ItemKind.tableEntry) {
      for (let a = start; a < start + (model.items.length[i] ?? 0); a++) words.add(a);
    } else if (kind === ItemKind.insn || kind === ItemKind.rawInsn) {
      const item = itemAt(model.items, i, rom, runOffset);
      const insn = item.kind === 'insn' || item.kind === 'raw-insn' ? item.insn : undefined;
      const flow = insn?.flow.kind;
      const reason = item.kind === 'raw-insn' ? item.reason : RAW_PRINTER_REASON;
      count(stats, { rawReason: reason, branch: flow === 'branch' || flow === 'bl', poolLoad: flow === 'pool-load' });
    }
  }
  const inner = new Set(chunk.innerLabels.map((l) => `${String(l.addr)}:${l.name}`));
  const placed = new Map<Addr, RawLabel>();
  const globals: string[] = [];
  const ordered = [...labels].sort((a, b) => compareNumbers(inner.has(`${String(b.addr)}:${b.name}`) ? 1 : 0, inner.has(`${String(a.addr)}:${a.name}`) ? 1 : 0) || compareLabels(a, b));
  for (const l of ordered) {
    const isInner = inner.has(`${String(l.addr)}:${l.name}`);
    if ((isInner || l.scope === 'global') && !placed.has(l.addr - runOffset)) {
      placed.set(l.addr - runOffset, { addr: l.addr - runOffset, name: l.name });
      if (l.scope === 'global') globals.push(l.name);
    }
  }
  const rawLabels = sortedEntries(placed).map(([, l]) => l);
  // printRawRange prints the PoC's lines; a global label is declared before them, which GNU as accepts.
  const out = globals.sort(compareCodeUnits).map((n) => `.global ${n}`);
  const head = labelAtStart ? placed.get(span.start) : undefined;
  if (head !== undefined) out.push(`${head.name}: @ ${hex(span.start)}`);
  pushAll(out, printRawRange(rom, (a) => words.has(a), span.start, span.end, rawLabels));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The chunk.

function printerOf(how: Printer | EmitContext | undefined): Printer {
  if (how === undefined) return DEFAULT_PRINTER;
  return typeof how === 'string' ? how : (how.printer ?? DEFAULT_PRINTER);
}

/**
 * Chunk `chunk` of `model` as assembly lines (no trailing newlines) and its statistics, with the readable
 * printer unless `how` (a Printer or an EmitContext) selects 'raw'. Statistics count the code items: with
 * the readable printer, what printed as a mnemonic and why the rest is raw; with the raw printer every
 * instruction is data, counted raw under its model reason or RAW_PRINTER_REASON.
 */
export function printChunk(rom: Rom, model: Model, chunk: number, how: Printer | EmitContext = DEFAULT_PRINTER): PrintedChunk {
  const c = model.chunks[chunk];
  if (c === undefined) throw new RomliftInvariantError(`printChunk: no chunk ${chunk} of ${model.chunks.length}`);
  const runOffset = runOffsetOf(c);
  const entry = chunkEntry(model, c);
  const all = chunkLabels(model, c, runOffset);
  const at = entry + runOffset;
  const head = headLabel(all, c, at);
  // The opening defines the chunk's own name; a label of that name elsewhere would be a second definition.
  const labels = all.filter((l) => l !== head && !(l.name === c.name && l.addr === at));
  const stats = counter();
  const cx: BodyContext = { rom, model, chunk: c, runOffset, labels, stats };
  const printer = printerOf(how);
  const lines: string[] = [];
  if (c.kind === 'header') {
    pushAll(lines, opening(c, head, at, []));
    pushAll(lines, headerBody(cx));
  } else {
    const pad = leadingPad(model, c, entry, labels, runOffset);
    const before = labels.filter((l) => l.addr < at);
    const after = labels.filter((l) => l.addr >= at);
    const last = c.items.first + c.items.count;
    const padSpan: Span = { start: c.span.start, end: entry };
    const bodySpan: Span = { start: entry, end: c.span.end };
    const prelude = pad.printed ? (printer === 'raw' ? rawItems(cx, c.items.first, pad.end, padSpan, before, true) : readableItems(cx, c.items.first, pad.end, before)) : [];
    pushAll(lines, opening(c, head, at, prelude));
    pushAll(lines, printer === 'raw' ? rawItems(cx, pad.end, last, bodySpan, after, false) : readableItems(cx, pad.end, last, after));
  }
  pushAll(lines, closing(c));
  return { lines, stats: finish(stats) };
}

/**
 * The items of a folded chunk's pad, before its entry: [first, end) of model.items. `printed` when they must be
 * printed before the start macro (a label lies in the pad, so the model holds it as data); otherwise they are the
 * one padding item the start macro's `.align 2, 0` emits, and print nothing. No pad: end is the chunk's first item.
 */
function leadingPad(model: Model, chunk: Chunk, entry: Addr, labels: readonly Label[], runOffset: number): { readonly end: number; readonly printed: boolean } {
  let end = chunk.items.first;
  while (end < chunk.items.first + chunk.items.count && (model.items.start[end] ?? entry) < entry) end++;
  if (end === chunk.items.first) return { end, printed: false };
  const one = end - chunk.items.first === 1 && model.items.kind[chunk.items.first] === ItemKind.padding;
  const labelled = labels.some((l) => l.addr - runOffset >= chunk.span.start && l.addr - runOffset < entry);
  return { end, printed: !one || labelled };
}
