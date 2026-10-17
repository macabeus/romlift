// decode(mode, word, addr): the table lookup of architecture §5. Thumb goes through a 65,536-entry
// index from halfword to row, built at module load; a bl prefix followed by a bl suffix (the high
// halfword of `word`) decodes as one 4-byte instruction. ARM goes through 4,096 buckets keyed on bits
// 27..20 and 7..4, each listing the rows those bits allow, in table order. Decode never throws: every
// word matches a row, because each table ends with a catch-all row, resolved once at module load.
import { RomliftInvariantError } from '../diagnostics/diagnostic.ts';
import type { Addr, Mode } from '../rom/span.ts';
import { flowOf } from './flow.ts';
import type { Row } from './row.ts';
import { ROWS } from './rows.ts';
import { THUMB_BL } from './thumb-table.ts';
import type { Fields, Insn } from './types.ts';

function matches(row: Row, word: number): boolean {
  return ((word & row.spec.mask) >>> 0) === row.spec.match;
}

const THUMB16: readonly Row[] = ROWS.thumb.filter((r) => r.spec.size === 2);

/** The last row of a table: its catch-all, which every word not matched earlier decodes to. */
function catchAll(rows: readonly Row[], table: string): Row {
  const last = rows[rows.length - 1];
  if (last === undefined) throw new RomliftInvariantError(`isa tables: the ${table} table is empty`);
  return last;
}

const THUMB_LAST: Row = catchAll(THUMB16, 'Thumb');
const ARM_LAST: Row = catchAll(ROWS.arm, 'ARM');

/** Halfword to index into THUMB16. */
const THUMB_INDEX: Uint16Array = (() => {
  const index = new Uint16Array(0x10000);
  for (let hw = 0; hw < 0x10000; hw++) {
    const at = THUMB16.findIndex((r) => matches(r, hw));
    index[hw] = at < 0 ? THUMB16.length - 1 : at;
  }
  return index;
})();

/** The bucket key of an ARM word: bits 27..20, then bits 7..4. */
function armKey(word: number): number {
  return ((word >>> 16) & 0xff0) | ((word >>> 4) & 0xf);
}

const ARM_BUCKETS: readonly (readonly Row[])[] = (() => {
  const buckets: Row[][] = [];
  for (let key = 0; key < 0x1000; key++) {
    buckets.push(ROWS.arm.filter((r) => ((key ^ armKey(r.spec.match)) & armKey(r.spec.mask)) === 0));
  }
  return buckets;
})();

/** The raw field values of `word` under a row. */
export function fieldsOf(row: Row, word: number): Fields {
  const out: Record<string, number> = {};
  for (const field of row.spec.fields) out[field.name] = (word >>> field.lo) & (2 ** field.width - 1);
  return out;
}

function armRow(word: number): Row {
  const bucket = ARM_BUCKETS[armKey(word)] ?? [];
  for (const r of bucket) if (matches(r, word)) return r;
  return ARM_LAST;
}

function thumbRow(word: number): Row {
  const hw = word & 0xffff;
  if ((hw & 0xf800) === 0xf000 && ((word >>> 16) & 0xf800) === 0xf800) return THUMB_BL;
  return THUMB16[THUMB_INDEX[hw] ?? THUMB16.length - 1] ?? THUMB_LAST;
}

/** The row `word` decodes to in `mode` (Thumb: the low halfword, paired with the high one for bl). */
export function rowFor(mode: Mode, word: number): Row {
  return mode === 'thumb' ? thumbRow(word >>> 0) : armRow(word >>> 0);
}

/**
 * Decodes the instruction at `addr`. Thumb: `word` holds the halfword at addr in its low 16 bits and
 * the one at addr + 2 (0 when absent) in its high 16 bits. ARM: the word at addr.
 */
export function decode(mode: Mode, word: number, addr: Addr): Insn {
  const row = rowFor(mode, word);
  const size = row.spec.size;
  const bytes = size === 2 ? word & 0xffff : word >>> 0;
  const fields = fieldsOf(row, bytes);
  return {
    addr,
    mode,
    size,
    word: bytes,
    specId: row.spec.id,
    fields,
    flow: flowOf(row.spec.flow, mode, row.toOps(fields, addr), addr),
  };
}
