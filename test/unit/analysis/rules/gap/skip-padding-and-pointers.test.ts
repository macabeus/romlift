// gap.skip-padding-and-pointers: the forward chain steps over a zero word or a Thumb pointer into the ROM,
// and stops at anything else.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/skip-padding-and-pointers.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { gapCursor } from './cursor.ts';

const P = 0x0800_0200;
const rom = romWith([{ at: P, bytes: words(0, 0x0800_0101, 0x0800_0100, 0x0300_0001, 0x1234_5678, 0x0800_0400 + 1) }], {
  size: 0x400,
});
const skip = (at: number): number | undefined => rule.skip(gapCursor(P, P + 0x40, at), viewWith({ rom }));

test('a zero word and an odd word pointing into the ROM are stepped over', () => {
  assert.equal(skip(P), P + 4);
  assert.equal(skip(P + 4), P + 8);
});

test('stops: an even ROM word, a Thumb pointer outside the ROM, any other word', () => {
  assert.equal(skip(P + 8), undefined);
  assert.equal(skip(P + 12), undefined);
  assert.equal(skip(P + 16), undefined);
  assert.equal(skip(P + 20), undefined, 'one past the ROM end');
});

test('stops at the ROM end', () => {
  assert.equal(skip(rom.end - 2), undefined);
});
