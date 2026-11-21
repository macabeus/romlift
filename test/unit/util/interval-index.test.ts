import assert from 'node:assert/strict';
import { test } from 'node:test';

import { innermost, intervalIndex } from '../../../src/foundation/util/interval-index.ts';
import type { Interval } from '../../../src/foundation/util/interval-index.ts';
import { prngSequence } from '../../helpers/prng.ts';

test('innermost returns the covering interval with the greatest start', () => {
  const idx = intervalIndex([
    { start: 0, end: 100, value: 'outer' },
    { start: 10, end: 20, value: 'inner' },
    { start: 12, end: 14, value: 'deepest' },
    { start: 50, end: 60, value: 'sibling' },
  ]);
  assert.equal(innermost(idx, 5)?.value, 'outer');
  assert.equal(innermost(idx, 11)?.value, 'inner');
  assert.equal(innermost(idx, 13)?.value, 'deepest');
  assert.equal(innermost(idx, 14)?.value, 'inner', 'ends are exclusive');
  assert.equal(innermost(idx, 20)?.value, 'outer');
  assert.equal(innermost(idx, 55)?.value, 'sibling');
  assert.equal(innermost(idx, 100), undefined);
  assert.equal(innermost(idx, -1), undefined);
});

test('ties: the same start prefers the smaller end, then the earlier interval; empty intervals never cover', () => {
  const idx = intervalIndex([
    { start: 0, end: 10, value: 'long' },
    { start: 0, end: 4, value: 'short' },
    { start: 0, end: 4, value: 'short-later' },
    { start: 6, end: 6, value: 'empty' },
  ]);
  assert.equal(innermost(idx, 2)?.value, 'short');
  assert.equal(innermost(idx, 6)?.value, 'long');
});

/** The brute-force definition: greatest start, then smallest end, then earliest. */
function brute(intervals: readonly Interval<number>[], a: number): number | undefined {
  let best: Interval<number> | undefined;
  for (const iv of intervals) {
    if (!(iv.start <= a && a < iv.end)) continue;
    if (best === undefined || iv.start > best.start || (iv.start === best.start && iv.end < best.end)) best = iv;
  }
  return best?.value;
}

test('random nested and overlapping intervals agree with a brute force', () => {
  const r = prngSequence(0x2026_1017, 4000);
  let k = 0;
  const next = (n: number): number => (r[k++] ?? 0) % n;
  for (let round = 0; round < 20; round++) {
    const intervals: Interval<number>[] = [];
    for (let i = 0; i < 60; i++) {
      const start = next(500);
      intervals.push({ start, end: start + next(120), value: i });
    }
    const idx = intervalIndex(intervals);
    for (let a = -2; a < 640; a += 3)
      assert.equal(innermost(idx, a)?.value, brute(intervals, a), `round ${round} at ${a}`);
  }
});
