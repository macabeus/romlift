// Array helpers every layer shares: appending without spreading into a call (a spread of a few hundred
// thousand lines overflows the call stack), and the two binary searches over sorted lists that the model,
// the printer and the checks use, each returning a checked index.

/** Appends every element of `items` to `out`, in order, without spreading them into a call. */
export function pushAll<T>(out: T[], items: Iterable<T>): void {
  for (const item of items) out.push(item);
}

/**
 * The first index in `list` (sorted ascending by `keyOf`) whose key is not below `key`; `list.length` when every
 * key is below it.
 */
export function lowerBound<T>(list: readonly T[], key: number, keyOf: (item: T) => number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const item = list[mid];
    if (item !== undefined && keyOf(item) < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A half-open span of numbers. */
interface NumberSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * The index in `list` of the span that contains `a`, or -1. The spans are sorted, disjoint and ascending
 * (they may leave gaps); `spanOf` gives each element's span.
 */
export function spanIndexAt<T>(list: readonly T[], a: number, spanOf: (item: T) => NumberSpan): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const item = list[mid];
    if (item === undefined) return -1;
    const span = spanOf(item);
    if (a < span.start) hi = mid - 1;
    else if (a >= span.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}
