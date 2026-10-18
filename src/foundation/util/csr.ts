// Compressed sparse rows over unsigned 32-bit keys and values (architecture §9.3): the keys sorted and
// unique, each key's values contiguous in the order they were given. A row is found by binary search.

export interface Csr {
  /** Sorted, unique. */
  readonly keys: Uint32Array;
  /** offsets[i]..offsets[i + 1] index the values of keys[i]; length keys.length + 1. */
  readonly offsets: Uint32Array;
  readonly values: Uint32Array;
}

const EMPTY = new Uint32Array(0);

/** Groups `values[i]` under `keys[i]` (the first `count` pairs); within a key, values keep their input order. */
export function csrFromPairs(keys: ArrayLike<number>, values: ArrayLike<number>, count = keys.length): Csr {
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  // A stable sort by key: ties keep input order.
  const sorted = Array.from(order).sort((a, b) => (keys[a] ?? 0) - (keys[b] ?? 0) || a - b);
  const unique: number[] = [];
  const offsets: number[] = [];
  const out = new Uint32Array(count);
  sorted.forEach((index, i) => {
    const key = (keys[index] ?? 0) >>> 0;
    if (unique.length === 0 || unique[unique.length - 1] !== key) {
      unique.push(key);
      offsets.push(i);
    }
    out[i] = (values[index] ?? 0) >>> 0;
  });
  offsets.push(count);
  return { keys: Uint32Array.from(unique), offsets: Uint32Array.from(offsets), values: out };
}

/** The index of `key` in `c.keys`, or -1. */
export function csrIndex(c: Csr, key: number): number {
  let lo = 0;
  let hi = c.keys.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const k = c.keys[mid] ?? 0;
    if (k === key) return mid;
    if (k < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The values under `key`, in input order; empty when the key is absent. */
export function csrRow(c: Csr, key: number): Uint32Array {
  const i = csrIndex(c, key);
  return i < 0 ? EMPTY : c.values.subarray(c.offsets[i] ?? 0, c.offsets[i + 1] ?? 0);
}

/** Whether `key` has a row. */
export function csrHas(c: Csr, key: number): boolean {
  return csrIndex(c, key) >= 0;
}
