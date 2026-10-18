// The innermost interval covering an address (architecture §9.3): owner() of the analysis. Intervals
// may nest or overlap; "innermost" is the covering interval with the greatest start, then the smallest
// end, then the earliest given. Each query walks a chain of parents whose length is the nesting depth
// at that address, so disjoint intervals answer in one binary search.

export interface Interval<T> {
  readonly start: number;
  readonly end: number;
  readonly value: T;
}

export interface IntervalIndex<T> {
  /** Sorted by start ascending, then end descending, then input order descending (the answer is the last covering item). */
  readonly items: readonly Interval<T>[];
  /** up[i]: the greatest j < i whose interval reaches past items[i].start, or -1. */
  readonly up: Int32Array;
}

/** Indexes the non-empty intervals of `intervals`. */
export function intervalIndex<T>(intervals: readonly Interval<T>[]): IntervalIndex<T> {
  const order = intervals
    .map((iv, i) => ({ iv, i }))
    .filter(({ iv }) => iv.end > iv.start)
    .sort((a, b) => a.iv.start - b.iv.start || b.iv.end - a.iv.end || b.i - a.i);
  const items = order.map(({ iv }) => iv);
  const up = new Int32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const start = items[i]?.start ?? 0;
    let j = i - 1;
    while (j >= 0 && (items[j]?.end ?? 0) <= start) j = up[j] ?? -1;
    up[i] = j;
  }
  return { items, up };
}

/** The index of the last item whose start is at most `a`, or -1. */
function lastStartingBy<T>(index: IntervalIndex<T>, a: number): number {
  let lo = 0;
  let hi = index.items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((index.items[mid]?.start ?? 0) <= a) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The innermost interval covering `a`, or undefined. */
export function innermost<T>(index: IntervalIndex<T>, a: number): Interval<T> | undefined {
  let j = lastStartingBy(index, a);
  while (j >= 0) {
    const item = index.items[j];
    if (item !== undefined && item.end > a) return item;
    j = index.up[j] ?? -1;
  }
  return undefined;
}
