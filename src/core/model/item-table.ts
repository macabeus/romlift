// The ItemTable (architecture §3.4, §9.4, D19): a builder that appends items in address order into
// growable typed arrays and finishes them to an ItemTable, and the lazy decoder `itemAt`. Instructions are
// stored as their isa row index and re-decoded from the ROM on demand, so the model holds about 17 bytes
// per item and no object per instruction. The builder checks each item's own shape (a caller bug throws
// RomliftInvariantError); whether the items tile the ROM is core/verify/tiling.ts's question.
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import { decode } from '../../foundation/isa/decode.ts';
import { ROWS } from '../../foundation/isa/rows.ts';
import type { Insn, SpecId } from '../../foundation/isa/types.ts';
import { contains, u16, u32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { DATA_NOTES, ITEM_RAW_REASONS, ItemKind, NO_SPEC } from './types.ts';
import type { DataNote, Item, ItemKindCode, ItemRawReason, ItemTable } from './types.ts';

// ---------------------------------------------------------------------------------------------------
// Spec indexes: every isa row of both tables, Thumb first, in table order.

const SPEC_IDS: readonly SpecId[] = [...ROWS.thumb, ...ROWS.arm].map((row) => row.spec.id);
const SPEC_INDEX: ReadonlyMap<SpecId, number> = new Map(SPEC_IDS.map((id, i) => [id, i] as const));

if (SPEC_IDS.length >= NO_SPEC)
  throw new RomliftInvariantError(`item table: ${SPEC_IDS.length} isa rows do not fit below NO_SPEC`);

/** The ItemTable.spec index of an isa row id. */
export function specIndex(id: SpecId): number {
  const index = SPEC_INDEX.get(id);
  if (index === undefined) throw new RomliftInvariantError(`item table: unknown spec '${id}'`);
  return index;
}

/** The isa row id of an ItemTable.spec index; undefined for NO_SPEC or an index no row has. */
export function specIdAt(index: number): SpecId | undefined {
  return SPEC_IDS[index];
}

/** The instruction set of an isa row: its id starts with `thumb.` or `arm.`. */
export function modeOfSpec(id: SpecId): Mode {
  return id.startsWith('thumb.') ? 'thumb' : 'arm';
}

// ---------------------------------------------------------------------------------------------------
// The builder.

/** One item to append, in load addresses. */
export type ItemInput =
  | { readonly kind: 'insn'; readonly start: Addr; readonly length: 2 | 4; readonly specId: SpecId }
  | {
      readonly kind: 'raw-insn';
      readonly start: Addr;
      readonly length: 2 | 4;
      readonly specId: SpecId | null;
      readonly reason: ItemRawReason;
    }
  | { readonly kind: 'pool'; readonly start: Addr; readonly value: number }
  | { readonly kind: 'table-entry'; readonly start: Addr; readonly target: Addr; readonly thumbBit: boolean }
  | { readonly kind: 'padding'; readonly start: Addr; readonly length: number }
  | { readonly kind: 'data'; readonly start: Addr; readonly length: number; readonly note?: DataNote };

export interface ItemTableBuilder {
  /** Appends one item and returns its index. */
  append(item: ItemInput): number;
  /** The number of items appended so far. */
  readonly count: number;
  /** The table of every item appended; the builder must not be used afterwards. */
  finish(): ItemTable;
}

const U32_MAX = 0xffff_ffff;

function isU32(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= U32_MAX;
}

interface Row {
  readonly kind: ItemKindCode;
  readonly start: number;
  readonly length: number;
  readonly spec: number;
  readonly aux: number;
}

function rowOf(item: ItemInput): Row {
  switch (item.kind) {
    case 'insn':
      return { kind: ItemKind.insn, start: item.start, length: item.length, spec: specIndex(item.specId), aux: 0 };
    case 'raw-insn':
      return {
        kind: ItemKind.rawInsn,
        start: item.start,
        length: item.length,
        spec: item.specId === null ? NO_SPEC : specIndex(item.specId),
        aux: ITEM_RAW_REASONS.indexOf(item.reason),
      };
    case 'pool':
      return { kind: ItemKind.pool, start: item.start, length: 4, spec: NO_SPEC, aux: item.value };
    case 'table-entry':
      if (item.target % 2 !== 0)
        throw new RomliftInvariantError(
          `item table: table target ${hexAddr(item.target)} is odd; the Thumb bit is thumbBit`,
        );
      return {
        kind: ItemKind.tableEntry,
        start: item.start,
        length: 4,
        spec: NO_SPEC,
        aux: (item.target | (item.thumbBit ? 1 : 0)) >>> 0,
      };
    case 'padding':
      return { kind: ItemKind.padding, start: item.start, length: item.length, spec: NO_SPEC, aux: 0 };
    case 'data':
      return {
        kind: ItemKind.data,
        start: item.start,
        length: item.length,
        spec: NO_SPEC,
        aux: item.note === undefined ? 0 : DATA_NOTES.indexOf(item.note) + 1,
      };
  }
}

/** A builder over growable arrays, starting at `capacity` items. */
export function itemTableBuilder(capacity = 1024): ItemTableBuilder {
  let size = Math.max(1, capacity);
  let count = 0;
  let kind = new Uint8Array(size);
  let start = new Uint32Array(size);
  let length = new Uint32Array(size);
  let spec = new Uint16Array(size);
  let aux = new Uint32Array(size);
  let finished = false;

  const grow = (): void => {
    size *= 2;
    const k = new Uint8Array(size);
    k.set(kind);
    kind = k;
    const s = new Uint32Array(size);
    s.set(start);
    start = s;
    const l = new Uint32Array(size);
    l.set(length);
    length = l;
    const p = new Uint16Array(size);
    p.set(spec);
    spec = p;
    const a = new Uint32Array(size);
    a.set(aux);
    aux = a;
  };

  return {
    append(item: ItemInput): number {
      if (finished) throw new RomliftInvariantError('item table: append after finish');
      const row = rowOf(item);
      if (!isU32(row.start) || !isU32(row.length) || row.length === 0 || row.start + row.length > U32_MAX + 1) {
        throw new RomliftInvariantError(
          `item table: bad ${item.kind} item at ${String(row.start)} of length ${String(row.length)}`,
        );
      }
      if (!isU32(row.aux))
        throw new RomliftInvariantError(
          `item table: ${item.kind} item at ${hexAddr(row.start)} has aux ${String(row.aux)}`,
        );
      if (count === size) grow();
      kind[count] = row.kind;
      start[count] = row.start;
      length[count] = row.length;
      spec[count] = row.spec;
      aux[count] = row.aux;
      return count++;
    },
    get count(): number {
      return count;
    },
    finish(): ItemTable {
      finished = true;
      return {
        count,
        kind: kind.slice(0, count),
        start: start.slice(0, count),
        length: length.slice(0, count),
        spec: spec.slice(0, count),
        aux: aux.slice(0, count),
      };
    },
  };
}

/** A table of no items. */
export function emptyItemTable(): ItemTable {
  return itemTableBuilder(1).finish();
}

// ---------------------------------------------------------------------------------------------------
// Reading.

/** The load span of item `i`. */
export function itemSpan(items: ItemTable, i: number): Span {
  const start = items.start[i];
  const length = items.length[i];
  if (start === undefined || length === undefined || i >= items.count)
    throw new RomliftInvariantError(`item table: no item ${i} of ${items.count}`);
  return { start, end: start + length };
}

/** The index of the item whose span contains load address `addr`, or -1. Items must be in address order. */
export function findItem(items: ItemTable, addr: Addr): number {
  // Typed-array columns, not a list of spans, so the search stays here (spanIndexAt takes a list).
  let lo = 0;
  let hi = items.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const start = items.start[mid] ?? 0;
    if (addr < start) hi = mid - 1;
    else if (addr >= start + (items.length[mid] ?? 0)) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * The instruction of item `i` decoded from the ROM at its run address (`start + runOffset`), or why it cannot be:
 * the item records no isa row, its bytes are not in the ROM, no instruction of its mode has its size, or its
 * bytes decode as another row or size than it records. A 4-byte Thumb item (a bl pair) is its first halfword |
 * its second << 16, the word u32 reads.
 */
export function decodeItemAt(rom: Rom, items: ItemTable, i: number, runOffset: number): Insn | string {
  const start = items.start[i] ?? 0;
  const size = items.length[i] ?? 0;
  const specId = specIdAt(items.spec[i] ?? NO_SPEC);
  if (specId === undefined) return 'it records no isa row';
  if (!contains(rom, start, size)) return `its ${size} bytes are not in the ROM`;
  const mode = modeOfSpec(specId);
  const word = size === 4 ? u32(rom, start) : size === 2 && mode === 'thumb' ? u16(rom, start) : undefined;
  if (word === undefined) return `a ${size}-byte ${mode} instruction cannot exist`;
  const insn = decode(mode, word, start + runOffset);
  if (insn.specId !== specId || insn.size !== size)
    return `it records ${specId} (${size} bytes) but its bytes decode as ${insn.specId} (${insn.size} bytes)`;
  return insn;
}

/** decodeItemAt, for an item the model built: a reason is a broken model, never content. */
function decodeAt(rom: Rom, items: ItemTable, i: number, runOffset: number): Insn {
  const insn = decodeItemAt(rom, items, i, runOffset);
  if (typeof insn === 'string')
    throw new RomliftInvariantError(`item table: the item at ${hexAddr(items.start[i] ?? 0)}: ${insn}`);
  return insn;
}

/**
 * Item `i`, decoded. An instruction is re-decoded from the ROM at its run address, `span.start +
 * runOffset`: pass the chunk's `runAt - span.start` inside a runs_at range (§6.7), else nothing.
 */
export function itemAt(items: ItemTable, i: number, rom: Rom, runOffset = 0): Item {
  const span = itemSpan(items, i);
  const kind = items.kind[i];
  const spec = items.spec[i] ?? NO_SPEC;
  const aux = items.aux[i] ?? 0;
  switch (kind) {
    case ItemKind.insn: {
      const specId = specIdAt(spec);
      if (specId === undefined)
        throw new RomliftInvariantError(`item table: insn item ${i} at ${hexAddr(span.start)} has no spec`);
      return { kind: 'insn', span, insn: decodeAt(rom, items, i, runOffset) };
    }
    case ItemKind.rawInsn: {
      const reason = ITEM_RAW_REASONS[aux];
      if (reason === undefined)
        throw new RomliftInvariantError(`item table: raw-insn item ${i} has reason code ${aux}`);
      const specId = spec === NO_SPEC ? undefined : specIdAt(spec);
      if (spec !== NO_SPEC && specId === undefined)
        throw new RomliftInvariantError(`item table: raw-insn item ${i} has spec index ${spec}`);
      return specId === undefined
        ? { kind: 'raw-insn', span, reason }
        : { kind: 'raw-insn', span, insn: decodeAt(rom, items, i, runOffset), reason };
    }
    case ItemKind.pool:
      return { kind: 'pool', span, value: aux };
    case ItemKind.tableEntry:
      return { kind: 'table-entry', span, target: (aux & ~1) >>> 0, thumbBit: (aux & 1) === 1 };
    case ItemKind.padding:
      return { kind: 'padding', span };
    case ItemKind.data: {
      if (aux === 0) return { kind: 'data', span };
      const note = DATA_NOTES[aux - 1];
      if (note === undefined) throw new RomliftInvariantError(`item table: data item ${i} has note code ${aux}`);
      return { kind: 'data', span, note };
    }
    default:
      throw new RomliftInvariantError(`item table: item ${i} has kind code ${String(kind)}`);
  }
}
