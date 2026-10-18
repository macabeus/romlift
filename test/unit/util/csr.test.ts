import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csrFromPairs, csrHas, csrIndex, csrRow } from '../../../src/foundation/util/csr.ts';

test('rows group values by key, keys sorted and unique, values in input order', () => {
  const c = csrFromPairs([30, 10, 30, 20, 10], [1, 2, 3, 4, 5]);
  assert.deepEqual([...c.keys], [10, 20, 30]);
  assert.deepEqual([...c.offsets], [0, 2, 3, 5]);
  assert.deepEqual([...csrRow(c, 10)], [2, 5]);
  assert.deepEqual([...csrRow(c, 20)], [4]);
  assert.deepEqual([...csrRow(c, 30)], [1, 3]);
  assert.deepEqual([...csrRow(c, 40)], []);
  assert.equal(csrHas(c, 20), true);
  assert.equal(csrHas(c, 25), false);
  assert.equal(csrIndex(c, 30), 2);
});

test('an empty index has no rows; keys up to 2^32 - 1 are kept unsigned', () => {
  const empty = csrFromPairs([], []);
  assert.equal(empty.keys.length, 0);
  assert.deepEqual([...empty.offsets], [0]);
  assert.equal(csrHas(empty, 0), false);
  const big = csrFromPairs([0xffff_fffe, 0x0800_0000], [7, 8]);
  assert.deepEqual([...big.keys], [0x0800_0000, 0xffff_fffe]);
  assert.deepEqual([...csrRow(big, 0xffff_fffe)], [7]);
});

test('count limits the pairs read', () => {
  const c = csrFromPairs([1, 2, 3], [4, 5, 6], 2);
  assert.deepEqual([...c.keys], [1, 2]);
});
