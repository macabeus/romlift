// Jump tables (architecture §5 "Jump tables"): one `.4byte` per table-entry item, to the label at its target
// (`_0800ABCD`, or `_0800ABCD + 1` when the stored value carries the Thumb bit). The addend is computed from
// what the linker writes for the label (resolver.ts wordValueOf), so a target whose preferred label is a
// Thumb function, which already links with the Thumb bit, prints `Func` for an odd entry and `Func - 1` for
// an even one. A target without a visible label prints its stored value.
import { hex } from '../../../foundation/util/hex.ts';
import { wordValueOf } from '../../model/resolver.ts';
import { visibleLabelsAt, type WordScope } from './pool.ts';

/** The operand of a table entry storing `target | thumbBit`, in the scope's module (pool.ts wordScope). */
export function tableEntryOperand(scope: WordScope, target: number, thumbBit: boolean): string {
  const stored = (target | (thumbBit ? 1 : 0)) >>> 0;
  const label = visibleLabelsAt(scope, target)[0];
  if (label === undefined) return `0x${hex(stored)}`;
  const addend = stored - wordValueOf(label);
  if (addend === 0) return label.name;
  return addend > 0 ? `${label.name} + ${addend}` : `${label.name} - ${-addend}`;
}

/** A table entry's line. */
export function tableEntryLine(scope: WordScope, target: number, thumbBit: boolean): string {
  return `\t.4byte ${tableEntryOperand(scope, target, thumbBit)}`;
}
