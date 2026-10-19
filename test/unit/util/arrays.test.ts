// foundation/util/arrays.ts: pushAll appends in order without a stack overflow on millions of elements;
// lowerBound and spanIndexAt agree with a linear scan on random sorted inputs, gaps and edges included.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lowerBound, pushAll, spanIndexAt } from '../../../src/foundation/util/arrays.ts';
import { xorshift32 } from '../../helpers/prng.ts';

/** Uniform numbers in [0, 1) from a seed. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = xorshift32(state);
    return state / 0x1_0000_0000;
  };
}

test('pushAll appends in order, also more elements than a call can take as arguments', () => {
  const out = [1, 2];
  pushAll(out, [3, 4]);
  assert.deepEqual(out, [1, 2, 3, 4]);
  const big = new Array<number>(3_000_000).fill(7);
  const into: number[] = [];
  assert.throws(() => into.push(...big), RangeError);
  pushAll(into, big);
  assert.equal(into.length, 3_000_000);
});

test('lowerBound is the first index whose key is not below the key', () => {
  const keys = [1, 3, 3, 5, 9];
  const id = (n: number): number => n;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9, 10].map((k) => lowerBound(keys, k, id)), [0, 0, 1, 1, 3, 3, 4, 5]);
  assert.equal(lowerBound([], 4, id), 0);
  const next = prng(7);
  for (let round = 0; round < 200; round++) {
    const list = Array.from({ length: Math.floor(next() * 30) }, () => Math.floor(next() * 50)).sort((a, b) => a - b);
    const key = Math.floor(next() * 55) - 2;
    const linear = list.findIndex((n) => n >= key);
    assert.equal(lowerBound(list, key, id), linear < 0 ? list.length : linear);
  }
});

test('spanIndexAt finds the containing span, -1 in a gap or outside', () => {
  const spans = [
    { start: 0, end: 4 },
    { start: 4, end: 6 },
    { start: 10, end: 12 },
  ];
  const same = (s: { readonly start: number; readonly end: number }): { readonly start: number; readonly end: number } => s;
  assert.deepEqual([-1, 0, 3, 4, 5, 6, 9, 10, 11, 12].map((a) => spanIndexAt(spans, a, same)), [-1, 0, 0, 1, 1, -1, -1, 2, 2, -1]);
  assert.equal(spanIndexAt([], 0, same), -1);
  const next = prng(11);
  for (let round = 0; round < 200; round++) {
    const list: { start: number; end: number }[] = [];
    let at = 0;
    for (let k = Math.floor(next() * 12); k > 0; k--) {
      at += Math.floor(next() * 3);
      const end = at + 1 + Math.floor(next() * 4);
      list.push({ start: at, end });
      at = end;
    }
    const a = Math.floor(next() * (at + 4)) - 2;
    assert.equal(spanIndexAt(list, a, same), list.findIndex((s) => a >= s.start && a < s.end));
  }
});
