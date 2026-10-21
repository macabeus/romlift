// Addresses, instruction modes and half-open spans: the vocabulary every layer shares (architecture §3).

/** A GBA bus address; the cartridge ROM starts at 0x0800_0000. */
export type Addr = number;

/** The two instruction sets of the ARM7TDMI. */
export type Mode = 'thumb' | 'arm';

/** The size of one instruction of `mode` (a Thumb `bl` pair is two), and the alignment every instruction of it keeps. */
export function insnUnit(mode: Mode): 2 | 4 {
  return mode === 'arm' ? 4 : 2;
}

/**
 * Whether `addr` is an instruction address of `mode`: halfword-aligned for Thumb, word-aligned for ARM. The one
 * predicate (fix round 6, architecture-b1-1) the assembler layout, the config's E_FUNCTION_MISALIGNED and the
 * analysis read.
 */
export function insnAligned(mode: Mode, addr: Addr): boolean {
  return addr % insnUnit(mode) === 0;
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
