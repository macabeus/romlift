import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prngSequence, xorshift32 } from '../../helpers/prng.ts';

test('xorshift32 from seed 1 yields the reference values', () => {
  // Marsaglia's xorshift32 with shifts 13, 17, 5; 270369 is the published first value for state 1.
  assert.deepEqual([...prngSequence(1, 5)], [270369, 67634689, 2647435461, 307599695, 2398689233]);
  assert.equal(xorshift32(1), 270369);
});

test('the sequence is a pure function of the seed', () => {
  assert.deepEqual(prngSequence(0xdead_beef, 64), prngSequence(0xdead_beef, 64));
  assert.notDeepEqual(prngSequence(1, 8), prngSequence(2, 8));
  assert.deepEqual([...prngSequence(7, 3)].slice(0, 2), [...prngSequence(7, 2)]);
});

test('every state stays a nonzero uint32', () => {
  for (const value of prngSequence(0xffff_ffff, 10_000)) {
    assert.ok(value > 0 && value <= 0xffff_ffff);
  }
});

test('a zero, negative, fractional or oversized state is refused', () => {
  for (const bad of [0, -1, 1.5, 2 ** 32, Number.NaN]) {
    assert.throws(() => xorshift32(bad), RangeError);
  }
  assert.throws(() => prngSequence(1, -1), RangeError);
  assert.equal(prngSequence(1, 0).length, 0);
});
