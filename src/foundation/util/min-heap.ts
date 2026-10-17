// A binary min-heap under an explicit total order (architecture §4.4, D10). With a total comparator the
// pop order depends only on the items, never on the heap's internal layout.

export interface MinHeap<T> {
  push(item: T): void;
  /** The least item, removed; undefined when empty. */
  pop(): T | undefined;
  readonly size: number;
}

/** An empty heap ordered by `compare` (negative: a before b). `compare` must be a total order. */
export function minHeap<T>(compare: (a: T, b: T) => number): MinHeap<T> {
  const items: T[] = [];
  const less = (i: number, j: number): boolean => compare(items[i] as T, items[j] as T) < 0;
  const swap = (i: number, j: number): void => {
    const t = items[i] as T;
    items[i] = items[j] as T;
    items[j] = t;
  };
  return {
    push(item: T): void {
      items.push(item);
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!less(i, parent)) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop(): T | undefined {
      if (items.length === 0) return undefined;
      const top = items[0];
      const last = items.pop() as T;
      if (items.length > 0) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < items.length && less(l, m)) m = l;
          if (r < items.length && less(r, m)) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
    get size(): number {
      return items.length;
    },
  };
}

/** The worklist key of architecture §4.4: address, then Thumb before ARM, then the rule's rank, then the proposal counter. */
export interface WorkKey {
  readonly addr: number;
  readonly modeRank: number;
  readonly ruleRank: number;
  readonly seq: number;
}

/** The total order of WorkKey. */
export function compareWorkKeys(a: WorkKey, b: WorkKey): number {
  return a.addr - b.addr || a.modeRank - b.modeRank || a.ruleRank - b.ruleRank || a.seq - b.seq;
}
