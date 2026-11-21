// Jump tables (architecture §5 "Jump tables"): one `.4byte` per table-entry item, to the label at its target
// (`_0800ABCD`, or `_0800ABCD + 1` when the stored value carries the Thumb bit). The label and its addend come from the
// one R_ARM_ABS32 rule (resolver.ts addendTo): the preferred visible label at the target some addend of which links to
// the stored value. A Thumb function links with the Thumb bit whatever the addend, so it names an odd entry (`Func`)
// and never an even one; labels.ts places a local label at an even entry's target that only Thumb functions name
// (phase-6 fix round 6, architecture-o1-1), which the entry names instead. A target without such a label prints its
// stored value.
import { hex } from '../../../foundation/util/hex.ts';
import { addendTo } from '../../model/resolver.ts';
import { type WordScope, visibleLabelsAt } from './pool.ts';

/** The operand of a table entry storing `target | thumbBit`, in the scope's module (pool.ts wordScope). */
export function tableEntryOperand(scope: WordScope, target: number, thumbBit: boolean): string {
  const stored = (target | (thumbBit ? 1 : 0)) >>> 0;
  for (const label of visibleLabelsAt(scope, target)) {
    const addend = addendTo(label, stored);
    // The label lies at the target, so the addend is 0, or 1 for the Thumb bit on a label that links to its address.
    if (addend !== undefined) return addend === 0 ? label.name : `${label.name} + ${addend}`;
  }
  return `0x${hex(stored)}`;
}

/** A table entry's line. */
export function tableEntryLine(scope: WordScope, target: number, thumbBit: boolean): string {
  return `\t.4byte ${tableEntryOperand(scope, target, thumbBit)}`;
}
