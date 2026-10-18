// Instruction lengths by address for a walk and the reading it becomes (Reading.insnAt): byte pages of
// 4 KiB, created as the walk reaches them, so recording and testing an address is an array access
// rather than a hash-table operation (milestone M2: a walk over a zero-filled data region decodes
// hundreds of thousands of instructions). A length of 0 means absent.
import type { Addr } from '../../../foundation/rom/span.ts';
import type { InsnLookup } from '../types.ts';

const PAGE_BITS = 12;
const PAGE_MASK = (1 << PAGE_BITS) - 1;

export class InsnIndex implements InsnLookup {
  private readonly pages = new Map<number, Uint8Array>();
  private lastKey = -1;
  private lastPage: Uint8Array | undefined;
  private count = 0;

  get size(): number {
    return this.count;
  }

  private page(a: Addr, create: boolean): Uint8Array | undefined {
    const key = a >>> PAGE_BITS;
    if (key === this.lastKey) return this.lastPage;
    let page = this.pages.get(key);
    if (page === undefined) {
      if (!create) return undefined;
      page = new Uint8Array(1 << PAGE_BITS);
      this.pages.set(key, page);
    }
    this.lastKey = key;
    this.lastPage = page;
    return page;
  }

  has(a: Addr): boolean {
    return (this.page(a, false)?.[a & PAGE_MASK] ?? 0) !== 0;
  }

  get(a: Addr): number | undefined {
    const len = this.page(a, false)?.[a & PAGE_MASK] ?? 0;
    return len === 0 ? undefined : len;
  }

  /** Records `len` (1 to 255) at `a`. */
  set(a: Addr, len: number): void {
    const page = this.page(a, true) as Uint8Array;
    const k = a & PAGE_MASK;
    if (page[k] === 0) this.count += 1;
    page[k] = len;
  }

  delete(a: Addr): void {
    const page = this.page(a, false);
    const k = a & PAGE_MASK;
    if (page === undefined || page[k] === 0) return;
    page[k] = 0;
    this.count -= 1;
  }
}
