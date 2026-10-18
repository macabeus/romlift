// The instruction lookup a built Reading keeps (Reading.insnAt, architecture §9.4): the lengths of its sorted,
// unique instructions in one byte array over the span they cover, offset by the first address. The walker's
// paged index (walk/insn-index.ts) allocates 4 KiB per page it touches, which a reading of a few dozen bytes
// would keep for its lifetime: measured on the 32 MiB synthetic ROM of g3.large-rom, 37,140 readings held
// 210 MiB of pages. A reading whose instructions are spread thinly over a wide span keeps two sorted typed
// arrays and answers by binary search instead, so the bytes kept stay proportional to the instructions.
import type { Addr } from '../../foundation/rom/span.ts';
import type { InsnLookup, InsnSpan } from './types.ts';

/** A span at most this many bytes per instruction (plus SPARSE_SLACK) is kept dense. */
const DENSE_BYTES_PER_INSN = 16;
const SPARSE_SLACK = 256;

/** The lengths over [start, start + lens.length); 0 means absent. */
class DenseInsnLookup implements InsnLookup {
  readonly start: Addr;
  readonly lens: Uint8Array;
  readonly size: number;

  constructor(start: Addr, lens: Uint8Array, size: number) {
    this.start = start;
    this.lens = lens;
    this.size = size;
  }

  get(a: Addr): number | undefined {
    const k = a - this.start;
    const len = k >= 0 && k < this.lens.length ? (this.lens[k] ?? 0) : 0;
    return len === 0 ? undefined : len;
  }

  has(a: Addr): boolean {
    return this.get(a) !== undefined;
  }
}

/** The lengths at sorted, unique addresses, by binary search. */
class SparseInsnLookup implements InsnLookup {
  readonly addrs: Float64Array;
  readonly lens: Uint8Array;

  constructor(addrs: Float64Array, lens: Uint8Array) {
    this.addrs = addrs;
    this.lens = lens;
  }

  get size(): number {
    return this.addrs.length;
  }

  get(a: Addr): number | undefined {
    let lo = 0;
    let hi = this.addrs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const at = this.addrs[mid] ?? 0;
      if (at === a) return this.lens[mid];
      if (at < a) lo = mid + 1;
      else hi = mid;
    }
    return undefined;
  }

  has(a: Addr): boolean {
    return this.get(a) !== undefined;
  }
}

/** The lookup of `insns`, which are sorted by address and unique, each 1 to 255 bytes long. */
export function frozenInsnLookup(insns: readonly InsnSpan[]): InsnLookup {
  const first = insns[0];
  const last = insns[insns.length - 1];
  if (first === undefined || last === undefined) return new DenseInsnLookup(0, new Uint8Array(0), 0);
  const span = last.addr - first.addr + 1;
  if (span <= insns.length * DENSE_BYTES_PER_INSN + SPARSE_SLACK) {
    const lens = new Uint8Array(span);
    for (const i of insns) lens[i.addr - first.addr] = i.len;
    return new DenseInsnLookup(first.addr, lens, insns.length);
  }
  const addrs = new Float64Array(insns.length);
  const lens = new Uint8Array(insns.length);
  insns.forEach((i, k) => {
    addrs[k] = i.addr;
    lens[k] = i.len;
  });
  return new SparseInsnLookup(addrs, lens);
}
