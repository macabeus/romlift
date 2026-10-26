// Rounding an address up to an alignment: the one definition (architecture-8; core/layout's word alignment, the gap
// scan's C-function alignment and the signature rules' member alignment all read it).

/** `a` rounded up to a multiple of `align` (a positive integer; a power of two in every caller). */
export function alignUp(a: number, align: number): number {
  return a + ((align - (a % align)) % align);
}
