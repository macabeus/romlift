// assemble(parsed, addr): the encoding GNU as picks for a parsed text at an address. Candidates are
// tried in asPriority order (table order breaks ties); a candidate encodes when its codec turns the
// operands into fields that fit their widths and those fields read back as the same operands, which
// is where range limits, alignment, Align(PC, 4) and immediate rotation are enforced.
import type { Addr } from '../rom/span.ts';
import { fieldsOf, rowFor } from './decode.ts';
import { encode, fieldsFit } from './encode.ts';
import type { Row } from './row.ts';
import { rowOf, rowOrder } from './rows.ts';
import type { Assembled, Fields, ParsedInsn } from './types.ts';

/** Whether every operand both records name holds the same value. */
function agrees(derived: Fields, parsed: Fields): boolean {
  for (const key of Object.keys(derived)) {
    const value = parsed[key];
    if (value !== undefined && value !== derived[key]) return false;
  }
  return true;
}

/** The word `row` encodes the operands as at `addr`, or undefined when it cannot. */
export function encodeOperands(row: Row, operands: Fields, addr: Addr): number | undefined {
  const fields = row.fromOps(operands, addr);
  if (fields === undefined || !fieldsFit(row.spec, fields)) return undefined;
  const word = encode(row.spec, fields);
  // Read the word back: a field that overlaps bits the row fixes (rd = pc, pc in a list) must not
  // change what the text says.
  return agrees(row.toOps(fieldsOf(row, word), addr), operands) ? word : undefined;
}

/** The encoding GNU as picks for `parsed` at `addr`, or undefined when no candidate fits. */
export function assemble(parsed: ParsedInsn, addr: Addr): Assembled | undefined {
  const rows = parsed.candidates.map(rowOf).sort((a, b) => a.spec.asPriority - b.spec.asPriority || rowOrder(a.spec.id) - rowOrder(b.spec.id));
  for (const row of rows) {
    const word = encodeOperands(row, parsed.operands, addr);
    if (word === undefined) continue;
    const decoded = rowFor(parsed.mode, word);
    return { specId: decoded.spec.id, size: row.spec.size, word };
  }
  return undefined;
}
