// The model's chunks (architecture §6.2; the PoC's tile()): the runs of items written as one unit, laid out
// per module so no chunk crosses a module border. In a code module: the cartridge header [base, base + 0xC0)
// is one `header` chunk (the cartridge entry's extent over it is clipped, correctness-6); past it, one chunk
// per listed entry that is not a label (core/layout/borders.ts tileCode: start = entry, end = min(extent end,
// next chunk start), at least 2 bytes) and one `orphan` chunk `unk_<ADDR>` for the bytes between functions,
// never glued to a neighbour. Chunks starting inside the startup region are `startup` chunks (asm/crt0.s); the
// orphans are cut at its end. A data module is one `data` chunk, split where a symbol of the config starts.
//
// A padding-only orphan is folded into the function after it (the owner's answer to Q5 b of phase 3, D68 e): the
// zeros `.align 2, 0` emits between two functions belong to the function whose start macro emits them
// (`thumb_func_start`, `arm_func_start` and their `_local` forms, foundation/asm/dialect.ts), so they get no file
// of their own and no byte changes. The function chunk then spans [pad start, its end); its entry and name stay,
// and its first item is the padding item (items.ts), which the printers leave to the start macro
// (core/emit/print/chunk.ts). Only a pad that macro emits is folded: 1 to 3 zero bytes up to a word-aligned entry
// of a function chunk of the same code module, outside the startup region, with no listed entry or [symbols]
// entry inside it. A pad of other bytes (0x46C0 nops), one before a module border or at a module's end, one in the
// startup region or a data module, and one before an entry at 2 mod 4 stay orphans.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { lowerBound, pushAll } from '../../foundation/util/arrays.ts';
import { compareNumbers, sortedKeys } from '../../foundation/util/sorted.ts';
import type { FunctionConfig } from '../config/schema.ts';
import { tileCode } from '../layout/borders.ts';
import type { PlacedEntry } from '../layout/borders.ts';
import { dataName, HEADER_NAME, orphanName } from './names.ts';
import type { Chunk, ChunkKind, Model, ModelSymbol, Module } from './types.ts';

/** The word `.align 2, 0` aligns to: the start macros of a function at a word-aligned entry emit up to WORD - 1 zeros. */
const WORD = 4;

/** A chunk before its items and inner labels are known. */
export interface ChunkPlan {
  readonly span: Span;
  readonly kind: ChunkKind;
  readonly name: string;
  readonly mode: Mode | null;
  /** The index of its module. */
  readonly module: number;
  /** The listed entry a function (or startup function) chunk starts at. */
  readonly entry?: Addr;
}

export interface ChunkInputs {
  readonly rom: Rom;
  /** In ROM order, tiling the ROM. */
  readonly modules: readonly Module[];
  /** The listed entries that start chunks (not labels), sorted by entry. */
  readonly entries: readonly PlacedEntry[];
  /** The config's functions: the name and mode of each entry. */
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
  readonly headerEnd: Addr;
  /** The end of the startup region; headerEnd when there is none. */
  readonly startupEnd: Addr;
  /** The symbols inside the ROM, in address order. */
  readonly symbols: readonly ModelSymbol[];
}

/** The data chunks of [start, end): split at every symbol that starts strictly inside, each named by the symbol at its start. */
function dataChunks(start: Addr, end: Addr, module: number, symbols: readonly ModelSymbol[]): ChunkPlan[] {
  const names = new Map(symbols.map((s) => [s.addr, s.name] as const));
  const starts = [start, ...symbols.map((s) => s.addr).filter((a) => a > start && a < end)];
  return starts.map((s, i) => ({ span: { start: s, end: starts[i + 1] ?? end }, kind: 'data', name: names.get(s) ?? dataName(s), mode: null, module }));
}

/** Whether some address of `sorted` (ascending) lies in [start, end). */
function anyIn(sorted: readonly Addr[], start: Addr, end: Addr): boolean {
  const i = lowerBound(sorted, start, (a) => a);
  return (sorted[i] ?? end) < end;
}

/**
 * Whether orphan `pad` is the padding the start macro of the function chunk `next` emits: `next` follows it in the
 * same module, its entry is word-aligned (so its macro is `thumb_func_start` or `arm_func_start`, each opening with
 * `.align 2, 0`, not `non_word_aligned_thumb_func_start`), the pad is shorter than a word and all zeros, and no
 * listed entry or [symbols] entry lies inside it (each needs a label there, which the macro's alignment cannot hold).
 */
function isFoldablePad(inputs: ChunkInputs, named: readonly Addr[], pad: ChunkPlan, next: ChunkPlan | undefined): boolean {
  if (pad.kind !== 'orphan' || next === undefined || next.kind !== 'function' || next.module !== pad.module) return false;
  const { start, end } = pad.span;
  if (next.entry !== end || next.span.start !== end || end % WORD !== 0 || end - start >= WORD) return false;
  for (let a = start; a < end; a++) if (inputs.rom.bytes[a - inputs.rom.base] !== 0) return false;
  return !anyIn(named, start, end);
}

/** The chunks with every padding-only orphan folded into the function chunk after it (isFoldablePad); `named` as there. */
function foldPads(inputs: ChunkInputs, named: readonly Addr[], chunks: readonly ChunkPlan[]): ChunkPlan[] {
  const out: ChunkPlan[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c === undefined) continue;
    const next = chunks[i + 1];
    if (next !== undefined && isFoldablePad(inputs, named, c, next)) {
      out.push({ ...next, span: { start: c.span.start, end: next.span.end } });
      i++;
    } else {
      out.push(c);
    }
  }
  return out;
}

/** The code chunks of [start, end) in module `module`; `named`: every listed entry and [symbols] address, ascending. */
function codeChunks(inputs: ChunkInputs, named: readonly Addr[], start: Addr, end: Addr, module: number): ChunkPlan[] {
  const tiled = tileCode(inputs.entries, start, end, [inputs.startupEnd]).map((t): ChunkPlan => {
    const startup = t.span.start < inputs.startupEnd;
    if (t.entry === undefined) return { span: t.span, kind: startup ? 'startup' : 'orphan', name: orphanName(t.span.start), mode: 'thumb', module };
    const f = inputs.functions.get(t.entry);
    return { span: t.span, kind: startup ? 'startup' : 'function', name: f?.name ?? orphanName(t.entry), mode: f?.mode ?? 'thumb', module, entry: t.entry };
  });
  return foldPads(inputs, named, tiled);
}

/** Every chunk of the ROM, in address order. */
export function planChunks(inputs: ChunkInputs): ChunkPlan[] {
  const out: ChunkPlan[] = [];
  const named = [...sortedKeys(inputs.functions), ...inputs.symbols.map((s) => s.addr)].sort(compareNumbers);
  inputs.modules.forEach((m, module) => {
    const { start, end } = m.span;
    const headerEnd = Math.min(end, inputs.headerEnd);
    if (start < headerEnd) out.push({ span: { start, end: headerEnd }, kind: 'header', name: HEADER_NAME, mode: null, module });
    const from = Math.max(start, inputs.headerEnd);
    if (from >= end) return;
    pushAll(out, m.kind === 'data' ? dataChunks(from, end, module, inputs.symbols) : codeChunks(inputs, named, from, end, module));
  });
  return out;
}

/**
 * The entry of chunk `chunk` of a model: for a function chunk, the entry of the listed function it is named after
 * that lies in its first word (past the pad a folded chunk opens with, foldPads); its start for any other chunk.
 * Its own label and start macro go there.
 */
export function chunkEntry(model: Pick<Model, 'functions'>, chunk: Pick<Chunk, 'kind' | 'name' | 'span'>): Addr {
  const { start } = chunk.span;
  if (chunk.kind !== 'function' || start % WORD === 0) return start;
  for (let i = lowerBound(model.functions, start, (f) => f.entry); i < model.functions.length; i++) {
    const f = model.functions[i];
    if (f === undefined || f.entry >= Math.min(chunk.span.end, start + WORD)) break;
    if (f.name === chunk.name && f.entry % WORD === 0) return f.entry;
  }
  return start;
}
