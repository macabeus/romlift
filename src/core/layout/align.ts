// The ARM word every module border is aligned to (architecture §6.2, D15): ld aligns every object to it, and
// agbcc aligns every C function to it.
import type { Addr } from '../../foundation/rom/span.ts';
import { alignUp as alignTo } from '../../foundation/util/align.ts';

/** The ARM word: ld aligns every object to it, and agbcc aligns every C function to it. */
export const WORD = 4;

/** `a` rounded up to a word. */
export function alignUp(a: Addr): Addr {
  return alignTo(a, WORD);
}
