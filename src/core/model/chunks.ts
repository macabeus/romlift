// The model's chunks (architecture §6.2; the PoC's tile()): the runs of items written as one unit, laid out
// per module so no chunk crosses a module border. In a code module: the cartridge header [base, base + 0xC0)
// is one `header` chunk (the cartridge entry's extent over it is clipped, correctness-6); past it, one chunk
// per listed entry that is not a label (core/layout/borders.ts tileCode: start = entry, end = min(extent end,
// next chunk start), at least 2 bytes) and one `orphan` chunk `unk_<ADDR>` for the bytes between functions,
// never glued to a neighbour. Chunks starting inside the startup region are `startup` chunks (asm/crt0.s); the
// orphans are cut at its end. A data module is one `data` chunk, split where a symbol of the config starts.
//
// A padding-only orphan is folded into a neighbour (the owner's answer to Q5 b of phase 3, D68 e; D75 d), so it gets
// no file and no INCLUDE_ASM stub of its own and no byte changes. A pad is 1 to 3 zero bytes up to a word-aligned
// address of a code module, outside the startup region, with no listed entry or [symbols] entry inside it (each needs
// a label there, which neither fold can hold):
// - before a word-aligned function entry of the same module, it is the zeros that function's start macro emits
//   (`thumb_func_start`, `arm_func_start` and their `_local` forms open with `.align 2, 0`, foundation/asm/dialect.ts):
//   the function chunk spans [pad start, its end), its `entry` stays (Chunk.entry), and its first item is the
//   padding item (items.ts), which the printers leave to the start macro (core/emit/print/chunk.ts);
// - at its module's end (a module border, or the data start, follows), it is the alignment of the object's end, which
//   the chunk before it in the module takes as its last item, a padding item printed `.align 2, 0`
//   (ChunkPlan.tailPad), when that chunk stays assembly: any chunk of an `asm` module, and an orphan of a `c` module.
//   After a function of a `c` module the pad stays its own orphan (with its own INCLUDE_ASM stub): once that function
//   is decompiled its C object ends with agbcc's code, and gas pads the end of that object's `.text` to the section's
//   alignment with a Thumb nop (0x46C0), not zeros, so the zeros must stay in an assembly chunk after it (fix round 3,
//   correctness-a1-4, D78 b; D75 d's claim that ld aligns the next object the same way was wrong: the object's own
//   section already ends aligned, so ld has nothing left to fill).
// A pad after a function at a `c` module's end, a pad of other bytes (a 0x46C0 nop, which no start macro emits and
// agbcc's output for the function before it does not hold; phase-4.md owner question Q7), one in the startup region
// or a data module, and one before an entry at 2 mod 4 stay orphans.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { lowerBound, pushAll } from '../../foundation/util/arrays.ts';
import { dataName, orphanName } from '../../foundation/util/project-files.ts';
import { compareNumbers, sortedKeys } from '../../foundation/util/sorted.ts';
import type { FunctionConfig } from '../config/schema.ts';
import { WORD, tileCode } from '../layout/borders.ts';
import type { PlacedEntry } from '../layout/borders.ts';
import { HEADER_NAME } from './names.ts';
import type { Chunk, ChunkKind, ModelSymbol, Module } from './types.ts';

// The word `.align 2, 0` aligns to (layout/align.ts WORD): the start macros of a function at a word-aligned entry emit up
// to WORD - 1 zeros.

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
  /** The start of the zero pad a code chunk took at its module's end (foldPads), its last item. */
  readonly tailPad?: Addr;
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
  return starts.map((s, i) => ({
    span: { start: s, end: starts[i + 1] ?? end },
    kind: 'data',
    name: names.get(s) ?? dataName(s),
    mode: null,
    module,
  }));
}

/** Whether some address of `sorted` (ascending) lies in [start, end). */
function anyIn(sorted: readonly Addr[], start: Addr, end: Addr): boolean {
  const i = lowerBound(sorted, start, (a) => a);
  return (sorted[i] ?? end) < end;
}

/**
 * Whether orphan `pad` is a pad (the module comment above): 1 to 3 zero bytes up to a word-aligned address, with no
 * listed entry or [symbols] entry inside it; `named` holds those addresses, ascending.
 */
function isPad(inputs: ChunkInputs, named: readonly Addr[], pad: ChunkPlan): boolean {
  if (pad.kind !== 'orphan') return false;
  const { start, end } = pad.span;
  if (end % WORD !== 0 || end - start >= WORD) return false;
  for (let a = start; a < end; a++) if (inputs.rom.bytes[a - inputs.rom.base] !== 0) return false;
  return !anyIn(named, start, end);
}

/** Whether pad `pad` is the alignment the start macro of the function chunk `next` emits: `next` starts at its end, at a word-aligned entry of the same module. */
function foldsForward(pad: ChunkPlan, next: ChunkPlan | undefined): next is ChunkPlan {
  return (
    next !== undefined &&
    next.kind === 'function' &&
    next.module === pad.module &&
    next.entry === pad.span.end &&
    next.span.start === pad.span.end
  );
}

/**
 * Whether pad `pad` ends its module's code (nothing of its module follows) and `previous`, a chunk of that module that
 * stays assembly, can take it: a function or orphan of an `asm` module, an orphan of a `c` module (never a function of
 * a `c` module, whose decompiled C object gas would end with a nop instead).
 */
function foldsBackward(
  inputs: ChunkInputs,
  pad: ChunkPlan,
  previous: ChunkPlan | undefined,
  next: ChunkPlan | undefined,
): previous is ChunkPlan {
  if (next !== undefined && next.module === pad.module) return false;
  if (previous === undefined || previous.module !== pad.module || previous.span.end !== pad.span.start) return false;
  if (previous.kind === 'orphan') return true;
  return previous.kind === 'function' && inputs.modules[pad.module]?.kind !== 'c';
}

/** The chunks of one module's code with every pad folded into a neighbour (the module comment above); `named` as in isPad. */
function foldPads(inputs: ChunkInputs, named: readonly Addr[], chunks: readonly ChunkPlan[]): ChunkPlan[] {
  const out: ChunkPlan[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c === undefined) continue;
    const next = chunks[i + 1];
    const previous = out[out.length - 1];
    if (!isPad(inputs, named, c)) {
      out.push(c);
    } else if (foldsForward(c, next)) {
      out.push({ ...next, span: { start: c.span.start, end: next.span.end } });
      i++;
    } else if (foldsBackward(inputs, c, previous, next)) {
      out[out.length - 1] = {
        ...previous,
        span: { start: previous.span.start, end: c.span.end },
        tailPad: c.span.start,
      };
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
    if (t.entry === undefined)
      return {
        span: t.span,
        kind: startup ? 'startup' : 'orphan',
        name: orphanName(t.span.start),
        mode: 'thumb',
        module,
      };
    const f = inputs.functions.get(t.entry);
    return {
      span: t.span,
      kind: startup ? 'startup' : 'function',
      name: f?.name ?? orphanName(t.entry),
      mode: f?.mode ?? 'thumb',
      module,
      entry: t.entry,
    };
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
    if (start < headerEnd)
      out.push({ span: { start, end: headerEnd }, kind: 'header', name: HEADER_NAME, mode: null, module });
    const from = Math.max(start, inputs.headerEnd);
    if (from >= end) return;
    pushAll(
      out,
      m.kind === 'data' ? dataChunks(from, end, module, inputs.symbols) : codeChunks(inputs, named, from, end, module),
    );
  });
  return out;
}

/** Where chunk `chunk`'s label and start macro go: its entry (a function chunk that folded a pad), else its start. */
export function chunkEntry(chunk: Pick<Chunk, 'entry' | 'span'>): Addr {
  return chunk.entry ?? chunk.span.start;
}
