// Addresses, instruction modes and half-open spans: the vocabulary every layer shares (architecture §3). The
// instruction set's own words (D121) are @match-kit/isa's: `Addr` (here a GBA bus address; the cartridge ROM starts at
// 0x0800_0000), `Mode` (the two instruction sets of the ARM7TDMI) and `insnUnit` (the size of one instruction of a
// mode, a Thumb `bl` pair being two, and the alignment every instruction of it keeps).
import type { Addr, Mode } from '@match-kit/isa/armv4t';

export { insnUnit } from '@match-kit/isa/armv4t';
export type { Addr, Mode } from '@match-kit/isa/armv4t';

/**
 * Whether `addr` is an instruction address of `mode`: halfword-aligned for Thumb, word-aligned for ARM (fix round 6,
 * architecture-b1-1). Its readers are the assembler layout, the config's E_FUNCTION_MISALIGNED and, since phase 6
 * (architecture-b2-8), the analysis' own tests on a pc or an entry (the walkers, the ARM gap scan,
 * valid.in-rom-unclaimed, seed.ram-copy) and the model's labels.
 */
export function insnAligned(mode: Mode, addr: Addr): boolean {
  // A mask, not `%`: the walkers ask this of every pc, and an address is a non-negative integer, whose low bits a mask
  // reads exactly (final-review gates-r1-1).
  return (addr & (mode === 'arm' ? 3 : 1)) === 0;
}

/** A half-open address range: `start` is inside, `end` is not; `start <= end`. */
export interface Span {
  readonly start: Addr;
  readonly end: Addr;
}

/** The number of bytes a span covers. */
export function spanLength(s: Span): number {
  return s.end - s.start;
}

/** Whether `a` lies inside the half-open span. */
export function spanContains(s: Span, a: Addr): boolean {
  return a >= s.start && a < s.end;
}
