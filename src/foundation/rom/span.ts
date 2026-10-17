// Addresses, instruction modes and half-open spans: the vocabulary every layer shares (architecture §3).

/** A GBA bus address; the cartridge ROM starts at 0x0800_0000. */
export type Addr = number;

/** The two instruction sets of the ARM7TDMI. */
export type Mode = 'thumb' | 'arm';

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
