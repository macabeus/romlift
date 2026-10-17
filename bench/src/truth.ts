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
   * The addresses inside the ROM where an unsized function's code can end, ascending: data mapping
   * symbols (`$d...`) and typed symbols (FUNC, OBJECT, SECTION). Read only by a dataset's `codeEnd` row
   * (dataset-check); absent in hand-built truths.
   */
  readonly ends?: readonly number[];
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

/** The end of the ELF's code: the largest addr + size of its functions. */
export function elfCodeEnd(truth: Pick<Truth, 'functions'>): number {
  return truth.functions.reduce((e, t) => Math.max(e, t.addr + t.size), 0);
}

/**
 * Where the code of the ELF's last function ends when the ELF gives it no size (D60 j): the first
 * code-ending symbol (Truth.ends) past it. Undefined when the last function is sized, or no such symbol
 * follows it.
 */
export function unsizedCodeEnd(truth: Truth): number | undefined {
  const end = elfCodeEnd(truth);
  const last = truth.byAddr.get(end);
  if (last === undefined || last.size !== 0 || truth.functions.some((t) => t.addr + t.size > end)) return undefined;
  return truth.ends?.find((a) => a > end);
}
