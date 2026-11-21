import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareWorkKeys, minHeap } from '../../../src/foundation/util/min-heap.ts';
import type { WorkKey } from '../../../src/foundation/util/min-heap.ts';
import { prngSequence } from '../../helpers/prng.ts';

test('pops in ascending order and is empty afterwards', () => {
  const h = minHeap<number>((a, b) => a - b);
  for (const v of prngSequence(7, 500)) h.push(v % 97);
  assert.equal(h.size, 500);
  const out: number[] = [];
  for (let v = h.pop(); v !== undefined; v = h.pop()) out.push(v);
  assert.deepEqual(
    out,
    [...out].sort((a, b) => a - b),
  );
  assert.equal(h.size, 0);
  assert.equal(h.pop(), undefined);
});

test('the work key is a total order: address, then Thumb before ARM, then rule rank, then sequence', () => {
  const keys: WorkKey[] = [
    { addr: 8, modeRank: 1, ruleRank: 0, seq: 0 },
    { addr: 8, modeRank: 0, ruleRank: 2, seq: 1 },
    { addr: 8, modeRank: 0, ruleRank: 1, seq: 5 },
    { addr: 8, modeRank: 0, ruleRank: 1, seq: 3 },
    { addr: 4, modeRank: 1, ruleRank: 9, seq: 9 },
  ];
  const h = minHeap(compareWorkKeys);
  for (const k of keys) h.push(k);
  const out: WorkKey[] = [];
  for (let k = h.pop(); k !== undefined; k = h.pop()) out.push(k);
  assert.deepEqual(
    out.map((k) => `${k.addr}/${k.modeRank}/${k.ruleRank}/${k.seq}`),
    ['4/1/9/9', '8/0/1/3', '8/0/1/5', '8/0/2/1', '8/1/0/0'],
  );
});

test('equal keys under a total order pop the same regardless of push order', () => {
  const items = [3, 1, 2, 1, 3, 2].map((v, seq) => ({ addr: v, modeRank: 0, ruleRank: 0, seq }));
  const pops = (order: readonly (typeof items)[number][]): string => {
    const h = minHeap(compareWorkKeys);
    for (const k of order) h.push(k);
    const out: string[] = [];
    for (let k = h.pop(); k !== undefined; k = h.pop()) out.push(`${k.addr}:${k.seq}`);
    return out.join(',');
  };
  assert.equal(pops(items), pops([...items].reverse()));
});
