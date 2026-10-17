// The truth of the real tier (architecture §8.1): the FUNC symbols of the reference ELF that lie inside
// the ROM, merged by address with the Thumb bit cleared, the first name and the largest size kept:
// romlift's elfFunctions (the PoC's truth.ts rule), in symbol-table order of first appearance, because
// the PoC names the owner of a false entry by the first containing function in that order.
import { elfFunctions, ROM_BASE, type ElfFile, type ElfFunction } from 'romlift';

export type TruthFunction = ElfFunction;

export interface Truth {
  /** In symbol-table order of first appearance. */
  readonly functions: readonly TruthFunction[];
  readonly byAddr: ReadonlyMap<number, TruthFunction>;
}

/** The ELF's functions inside `[ROM_BASE, ROM_BASE + romSize)`. */
export function elfTruth(elf: ElfFile, romSize: number): Truth {
  const functions = elfFunctions(elf, { start: ROM_BASE, end: ROM_BASE + romSize }, 'symbol-table');
  return { functions, byAddr: new Map(functions.map((f) => [f.addr, f] as const)) };
}
