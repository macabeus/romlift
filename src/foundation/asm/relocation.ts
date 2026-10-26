// The word a data value `<symbol> + <addend>` links to: R_ARM_ABS32's (S + A) | T (ELF for the Arm Architecture,
// "Static Data relocations"), T being 1 when the symbol is a Thumb function. The addend is added before T is set, so
// `.4byte ThumbFunc + 3` links to the function's address plus 3, not plus 4 (phase-6 fix round 5, architecture-o0-1).
// The one source of the rule: the assembler layout (layout.ts) reads it for every data value, core's printer rule
// (core/model/resolver.ts linkedWordOf) for the words it names, and the bench's objdiff classifier through
// romlift/internal.

/** What a symbol stands for in a relocation: its address and whether it is a Thumb function (T). */
export interface SymbolValue {
  readonly addr: number;
  readonly thumbFunction: boolean;
}

/** R_ARM_ABS32: (S + A) | T, as an unsigned 32-bit word. */
export function abs32Word(symbol: SymbolValue, addend: number): number {
  return ((symbol.addr + addend) | (symbol.thumbFunction ? 1 : 0)) >>> 0;
}
