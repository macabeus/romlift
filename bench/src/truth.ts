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

/**
 * The end of the ELF's code: the largest addr + size of its functions, the convention of the PoC and of
 * every scorer since phase 1 (an unsized function, hand-written asm without `.size`, ends where it
 * starts). One convention for every ROM, tuning and sealed, and for the rescoring of the PoC's dumps. A
 * different reading for unsized functions (D60 j, withdrawn in fix round 2 of D60) changes a gate input
 * and waits for the owner (phase-2.md, Owner questions, Q5).
 */
export function elfCodeEnd(truth: Pick<Truth, 'functions'>): number {
  return truth.functions.reduce((e, t) => Math.max(e, t.addr + t.size), 0);
}
