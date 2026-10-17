import assert from 'node:assert/strict';
import { test } from 'node:test';

import returnsOrPrologue from '../../../../src/core/analysis/rules/valid/returns-or-prologue.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const E = 0x0800_0200;

test('a reading that returns passes', () => {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`movs r0, #1; bx lr` }]);
  assert.equal(returnsOrPrologue.check(readingOf(rom, { entry: E, returns: 1 }), viewWith({ rom })), undefined);
});

test('no return passes when the entry opens with push {.., lr}, at any alignment', () => {
  const at = E + 2;
  const rom = romWith([{ at, bytes: thumbAt(at)`push {lr}; bl _08000400` }]);
  assert.equal(returnsOrPrologue.check(readingOf(rom, { entry: at }), viewWith({ rom })), undefined);
});

test('no return and no push {.., lr} fails', () => {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`push {r4}; bl _08000400` }]);
  assert.equal(returnsOrPrologue.check(readingOf(rom, { entry: E }), viewWith({ rom })), 'no return and no push {.., lr}');
  assert.equal(returnsOrPrologue.reason, 'no-return-no-prologue');
  assert.equal(returnsOrPrologue.intrinsic, true);
});
