import assert from 'node:assert/strict';
import { test } from 'node:test';

import balancedStack from '../../../../src/core/analysis/rules/valid/balanced-stack.ts';
import { readingOf, romWith, viewWith, walkReading } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const E = 0x0800_0200;

test('a function that pops what it pushed passes', () => {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`push {r4, lr}; movs r4, #0; pop {r4, pc}` }]);
  const v = viewWith({ rom });
  assert.equal(balancedStack.check(walkReading(v, E, 'thumb'), v), undefined);
});

test('a return path that pops more than it pushed fails as pops-frame', () => {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`movs r4, #0; pop {r4, pc}` }]);
  const v = viewWith({ rom });
  assert.equal(balancedStack.check(walkReading(v, E, 'thumb'), v), 'a return path pops more than it pushed');
  assert.equal(balancedStack.reason, 'pops-frame');
  assert.equal(balancedStack.intrinsic, true);
});

test('the boundary: a delta of 0 or below passes, any positive delta fails', () => {
  const rom = romWith([]);
  const v = viewWith({ rom });
  assert.equal(balancedStack.check(readingOf(rom, { entry: E, balance: [0, -8] }), v), undefined);
  assert.notEqual(balancedStack.check(readingOf(rom, { entry: E, balance: [0, 4] }), v), undefined);
});
