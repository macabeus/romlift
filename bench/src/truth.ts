// The truth of the real tier (architecture §8.1): the FUNC symbols of the reference ELF that lie inside
// the ROM, merged by address with the Thumb bit cleared, the first name and the largest size kept (the
// PoC's truth.ts). The symbol-table order of first appearance is kept too, because the PoC names the
// owner of a false entry by the first containing function in that order.
import { ROM_BASE, type ElfFile } from 'romlift';

export interface TruthFunction {
  readonly addr: number;
  readonly size: number;
  readonly name: string;
  readonly thumb: boolean;
}

export interface Truth {
  /** In symbol-table order of first appearance. */
  readonly functions: readonly TruthFunction[];
  readonly byAddr: ReadonlyMap<number, TruthFunction>;
}

/** The ELF's functions inside `[ROM_BASE, ROM_BASE + romSize)`. */
export function elfTruth(elf: ElfFile, romSize: number): Truth {
  const end = ROM_BASE + romSize;
  const order: number[] = [];
  const byAddr = new Map<number, TruthFunction>();
  for (const s of elf.symbols) {
    if (s.type !== 'func' || s.addr < ROM_BASE || s.addr >= end) continue;
    const have = byAddr.get(s.addr);
    if (have === undefined) {
      order.push(s.addr);
      byAddr.set(s.addr, { addr: s.addr, size: s.size, name: s.name, thumb: s.thumb });
    } else if (s.size > have.size) {
      byAddr.set(s.addr, { ...have, size: s.size });
    }
  }
  const functions: TruthFunction[] = [];
  for (const a of order) {
    const f = byAddr.get(a);
    if (f !== undefined) functions.push(f);
  }
  return { functions, byAddr };
}
