// gap.backward-prologue-chain: the highest raw push {.., lr} below the end, within prologueDistance,
// valid and ending within fillSlack of the end.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../src/core/analysis/rules/gap/backward-prologue-chain.ts';
import type { ViewSetup } from '../../../helpers/analysis.ts';
import { romWith, viewWith } from '../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const X = 0x0800_0300;
const rom = romWith([
  { at: X, bytes: thumbAt(X)`push {lr}; movs r0, #0; movs r0, #0; movs r0, #0; push {r4, lr}; movs r0, #0; pop {r4}; pop {pc}` },
  { at: X + 0x40, bytes: thumbAt(X + 0x40)`movs r0, #0; movs r1, #0; bx lr` },
]);
const propose = (end: number, setup: Partial<ViewSetup> = {}, at = X - 0x100) => rule.propose(gapCursor(X - 0x100, end, at, { end }), viewWith({ rom, ...setup }));

test('the highest push {.., lr} whose reading ends within fillSlack of the end', () => {
  assert.deepEqual(propose(X + 0x10), { entry: X + 8, mode: 'thumb', proposedBy: 'gap.backward-prologue-chain', cites: [X + 8, X + 0x10] });
  assert.equal(propose(X + 0x10, { valid: (a) => a !== X + 8 })?.entry, X, 'X+8 invalid: the next push {.., lr} down, whose reading ends there too');
});

test('fillSlack is the only fit: an anchored reading that ends short does not count (profile boundary)', () => {
  assert.equal(propose(X + 0x13)?.entry, X + 8, 'agbcc: 3 bytes');
  assert.equal(propose(X + 0x14), undefined, 'agbcc: 4 bytes short');
  assert.equal(propose(X + 0x14, { functions: [X + 0x10] }), undefined, 'anchored at its end is not enough');
  assert.equal(propose(X + 0x11, { profile: DUMMY_PROFILE })?.entry, X + 8, 'dummy: 1 byte');
  assert.equal(propose(X + 0x12, { profile: DUMMY_PROFILE }), undefined, 'dummy: 2 bytes short');
});

test('declined: no push {.., lr}, a function, an invalid entry, a cursor above it', () => {
  assert.equal(propose(X + 0x46), undefined, 'the code at X+0x40 has no prologue');
  assert.equal(propose(X + 0x10, { functions: [X + 8], valid: (a) => a === X + 8 }), undefined);
  assert.equal(propose(X + 0x10, { valid: () => false }), undefined);
  assert.equal(propose(X + 0x10, {}, X + 0x0c), undefined);
});

test('prologueDistance bounds the window below the end (profile boundary)', () => {
  const far = romWith([{ at: X, bytes: thumbAt(X)`push {lr}; movs r0, #0; b _08000348` }, { at: X + 0x48, bytes: thumbAt(X + 0x48)`pop {pc}` }]);
  const c = gapCursor(X - 0x100, X + 0x4a, X - 0x100);
  assert.equal(rule.propose(c, viewWith({ rom: far }))?.entry, X, 'agbcc: 74 bytes ≤ 4096');
  assert.equal(rule.propose(c, viewWith({ rom: far, profile: DUMMY_PROFILE })), undefined, 'dummy: 74 bytes > 64');
});
