import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareCodeUnits, compareNumbers, sortedEntries, sortedKeys } from '../../../src/foundation/util/sorted.ts';

test('compareCodeUnits orders by UTF-16 code unit, not by locale', () => {
  const words = ['b', 'B', 'a', 'A', 'é', 'e', 'Z', '_', '10', '9', '😀', '￿'];
  assert.deepEqual([...words].sort(compareCodeUnits), ['10', '9', 'A', 'B', 'Z', '_', 'a', 'b', 'e', 'é', '😀', '￿']);
  assert.equal(compareCodeUnits('x', 'x'), 0);
  assert.equal(compareCodeUnits('ab', 'a'), 1);
});

test('compareNumbers orders numerically', () => {
  assert.deepEqual([10, 9, -1, 0x8000_0000, 2].sort(compareNumbers), [-1, 2, 9, 10, 0x8000_0000]);
  assert.equal(compareNumbers(3, 3), 0);
});

test('sortedKeys sorts Map keys and Set members', () => {
  assert.deepEqual(sortedKeys(new Map([[10, 'a'], [9, 'b'], [100, 'c']])), [9, 10, 100]);
  assert.deepEqual(sortedKeys(new Set(['b', 'a', 'B'])), ['B', 'a', 'b']);
  assert.deepEqual(sortedKeys(new Map<string | number, number>([['x', 1], [2, 2], [1, 3]])), [1, 2, 'x']);
  assert.deepEqual(sortedKeys(new Set<number>()), []);
});

test('sortedEntries sorts by key and leaves the map unchanged', () => {
  const m = new Map([['z', 1], ['a', 2], ['m', 3]]);
  assert.deepEqual(sortedEntries(m), [['a', 2], ['m', 3], ['z', 1]]);
  assert.deepEqual([...m.keys()], ['z', 'a', 'm']);
});
