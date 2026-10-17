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
  /**
   * The addresses inside the ROM where an unsized function's code ends, ascending: data mapping symbols
   * (`$d...`) and typed symbols (FUNC, with the Thumb bit cleared, OBJECT, SECTION). elfCodeEnd reads it.
   */
  readonly ends: readonly number[];
}

/** Whether a symbol marks where the code before it ends: a data mapping symbol or a typed symbol. */
function endsCode(s: ElfFile['symbols'][number]): boolean {
  return s.name === '$d' || s.name.startsWith('$d.') || s.type === 'func' || s.type === 'object' || s.type === 'section';
}

/** The ELF's functions inside `[ROM_BASE, ROM_BASE + romSize)`. */
export function elfTruth(elf: ElfFile, romSize: number): Truth {
  const functions = elfFunctions(elf, { start: ROM_BASE, end: ROM_BASE + romSize }, 'symbol-table');
  const end = ROM_BASE + romSize;
  const ends = [...new Set(elf.symbols.filter((s) => endsCode(s) && s.addr >= ROM_BASE && s.addr <= end).map((s) => s.addr))].sort((a, b) => a - b);
  return { functions, byAddr: new Map(functions.map((f) => [f.addr, f] as const)), ends };
}

/** The first address of `ends` (ascending) above `addr`, or undefined. */
function nextEnd(ends: readonly number[], addr: number): number | undefined {
  let lo = 0;
  let hi = ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((ends[mid] ?? 0) <= addr) lo = mid + 1;
    else hi = mid;
  }
  return ends[lo];
}

/**
 * The end of the ELF's code, one convention for every ROM, tuning and sealed, in the tuning and the sealed
 * scorer (D60 j, the owner's answer to Q5 on 18 October 2026: "Use $d for every ROM"): the largest end
 * of its functions, where a sized function ends at addr + size (agbcc's .size, its literal pool
 * included) and an unsized one (hand-written asm without .size, size 0) at the first data mapping or
 * typed symbol after it, where the assembler stopped emitting its instructions. A trailing pool of
 * hand-written asm is data the file's functions share, so it is not given to the last of them.
 */
export function elfCodeEnd(truth: Pick<Truth, 'functions' | 'ends'>): number {
  return truth.functions.reduce((e, t) => Math.max(e, t.size > 0 ? t.addr + t.size : (nextEnd(truth.ends, t.addr) ?? t.addr)), 0);
}

/**
 * The PoC's code end (the largest addr + size, an unsized function ending where it starts): only for
 * rescoring the PoC's own dumps against its baseline (poc-check, g1.bench-harness), which must reproduce
 * the PoC's scoring.
 */
export function pocCodeEnd(truth: Pick<Truth, 'functions'>): number {
  return truth.functions.reduce((e, t) => Math.max(e, t.addr + t.size), 0);
}
