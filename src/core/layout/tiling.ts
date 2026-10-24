// Tiling the code region (the PoC's tile(), architecture §6.2): one function chunk per entry that starts one,
// one orphan chunk for the bytes between, cut at given addresses. core/model/chunks.ts tiles with it exactly as
// borders.ts's codeLayout does, so the model's chunks are the ones the borders were computed over, except that the
// model folds a padding-only orphan into the function after it: such a pad is shorter than a word and ends at a
// word-aligned entry, so it never starts at a word boundary, and the legal borders (word-aligned chunk starts) are
// the same either way.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import type { PlacedEntry } from './entries.ts';

/** One chunk of the code region: a function chunk names its entry; an orphan chunk has none. */
export interface TiledChunk {
  readonly span: Span;
  readonly entry: Addr | undefined;
}

/** The index of the first entry at or above `a` in `entries` (sorted by entry). */
function firstAtOrAbove(entries: readonly { readonly entry: Addr }[], a: Addr): number {
  return lowerBound(entries, a, (e) => e.entry);
}

/**
 * Tiles [from, to): one function chunk per entry (start = entry, end = min(extent end, next entry), at least 2
 * bytes, never past `to`), one orphan chunk for the bytes between, orphans cut at each of `cuts`. `entries` are
 * the chunk-starting entries sorted by entry; an entry inside the previous chunk starts none (its caller makes
 * it an inner label).
 */
export function tileCode(entries: readonly PlacedEntry[], from: Addr, to: Addr, cuts: readonly Addr[]): TiledChunk[] {
  const out: TiledChunk[] = [];
  const orphan = (a: Addr, b: Addr): void => {
    let start = a;
    for (const c of cuts) {
      if (c > start && c < b) {
        out.push({ span: { start, end: c }, entry: undefined });
        start = c;
      }
    }
    if (b > start) out.push({ span: { start, end: b }, entry: undefined });
  };
  let cursor = from;
  const first = firstAtOrAbove(entries, from);
  const last = firstAtOrAbove(entries, to);
  for (let i = first; i < last; i++) {
    const e = entries[i];
    if (e === undefined || e.entry < cursor) continue;
    if (e.entry > cursor) orphan(cursor, e.entry);
    const next = i + 1 < last ? (entries[i + 1]?.entry ?? to) : to;
    const end = Math.min(to, Math.max(e.entry + 2, Math.min(e.end ?? next, next)));
    out.push({ span: { start: e.entry, end }, entry: e.entry });
    cursor = end;
  }
  if (cursor < to) orphan(cursor, to);
  return out;
}

