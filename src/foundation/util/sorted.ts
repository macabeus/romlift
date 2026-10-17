// Deterministic orders: strings by UTF-16 code unit (never the locale), numbers numerically, and the
// only sanctioned way to iterate a Map or Set where the order reaches an output (architecture §2).

/** Orders strings by UTF-16 code unit, independent of the locale. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Orders numbers ascending. */
export function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Numbers numerically and before strings; strings by code unit. */
function compareKeys(a: string | number, b: string | number): number {
  if (typeof a === 'number') return typeof b === 'number' ? compareNumbers(a, b) : -1;
  return typeof b === 'number' ? 1 : compareCodeUnits(a, b);
}

/** The keys of a Map, or the members of a Set, in sorted order. */
export function sortedKeys<K extends string | number>(m: ReadonlyMap<K, unknown> | ReadonlySet<K>): K[] {
  return Array.from(m.keys()).sort(compareKeys);
}

/** The entries of a Map, sorted by key. */
export function sortedEntries<K extends string | number, V>(m: ReadonlyMap<K, V>): [K, V][] {
  return Array.from(m.entries()).sort((x, y) => compareKeys(x[0], y[0]));
}
