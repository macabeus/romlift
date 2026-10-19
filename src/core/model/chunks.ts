// The model's chunks (architecture §6.2; the PoC's tile()): the runs of items written as one unit, laid out
// per module so no chunk crosses a module border. In a code module: the cartridge header [base, base + 0xC0)
// is one `header` chunk (the cartridge entry's extent over it is clipped, correctness-6); past it, one chunk
// per listed entry that is not a label (core/layout/borders.ts tileCode: start = entry, end = min(extent end,
// next chunk start), at least 2 bytes) and one `orphan` chunk `unk_<ADDR>` for the bytes between functions,
// never glued to a neighbour. Chunks starting inside the startup region are `startup` chunks (asm/crt0.s); the
// orphans are cut at its end. A data module is one `data` chunk, split where a symbol of the config starts.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { pushAll } from '../../foundation/util/arrays.ts';
import type { FunctionConfig } from '../config/schema.ts';
import { tileCode } from '../layout/borders.ts';
import type { PlacedEntry } from '../layout/borders.ts';
import { dataName, HEADER_NAME, orphanName } from './names.ts';
import type { ChunkKind, ModelSymbol, Module } from './types.ts';

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

/** The code chunks of [start, end) in module `module`. */
function codeChunks(inputs: ChunkInputs, start: Addr, end: Addr, module: number): ChunkPlan[] {
  return tileCode(inputs.entries, start, end, [inputs.startupEnd]).map((t): ChunkPlan => {
    const startup = t.span.start < inputs.startupEnd;
    if (t.entry === undefined) return { span: t.span, kind: startup ? 'startup' : 'orphan', name: orphanName(t.span.start), mode: 'thumb', module };
    const f = inputs.functions.get(t.entry);
    return { span: t.span, kind: startup ? 'startup' : 'function', name: f?.name ?? orphanName(t.entry), mode: f?.mode ?? 'thumb', module, entry: t.entry };
  });
}

/** Every chunk of the ROM, in address order. */
export function planChunks(inputs: ChunkInputs): ChunkPlan[] {
  const out: ChunkPlan[] = [];
  inputs.modules.forEach((m, module) => {
    const { start, end } = m.span;
    const headerEnd = Math.min(end, inputs.headerEnd);
    if (start < headerEnd) out.push({ span: { start, end: headerEnd }, kind: 'header', name: HEADER_NAME, mode: null, module });
    const from = Math.max(start, inputs.headerEnd);
    if (from >= end) return;
    pushAll(out, m.kind === 'data' ? dataChunks(from, end, module, inputs.symbols) : codeChunks(inputs, from, end, module));
  });
  return out;
}
