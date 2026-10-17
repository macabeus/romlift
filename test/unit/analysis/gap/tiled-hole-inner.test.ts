// gap.tiled-hole-inner: the head at a forward-chain cursor is proposed when it fills the gap to within
// fillSlack bytes or a function starts right after it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../src/core/analysis/rules/gap/tiled-hole-inner.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const P = 0x0800_0200;
const rom = romWith([{ at: P + 0x10, bytes: thumbAt(P + 0x10)`bx lr` }]);
const head = readingOf(rom, { entry: P, insns: [{ addr: P, len: 2 }, { addr: P + 2, len: 2 }, { addr: P + 4, len: 2 }], end: P + 0x10 });

test('a head ending within fillSlack of the end is proposed with its origin rule (profile boundary)', () => {
  const v = viewWith({ rom });
  assert.deepEqual(rule.propose(gapCursor(P, P + 0x13, P, { head }), v), { entry: P, mode: 'thumb', proposedBy: 'gap.tiled-hole-inner', cites: [P, P + 0x10, P + 0x13] });
  assert.equal(rule.propose(gapCursor(P, P + 0x10, P, { head }), v)?.entry, P, 'exactly at the end');
  assert.equal(rule.propose(gapCursor(P, P + 0x14, P, { head }), v), undefined, 'agbcc: 4 bytes short');
  const dummy = viewWith({ rom, profile: DUMMY_PROFILE });
  assert.equal(rule.propose(gapCursor(P, P + 0x11, P, { head }), dummy)?.entry, P, 'dummy: 1 byte');
  assert.equal(rule.propose(gapCursor(P, P + 0x12, P, { head }), dummy), undefined, 'dummy: 2 bytes short');
});

test('a head anchored at its end by a function is proposed however far the gap goes on', () => {
  assert.equal(rule.propose(gapCursor(P, P + 0x40, P, { head }), viewWith({ rom, functions: [P + 0x10] }))?.entry, P);
});

test('declined: no head, or a head that runs past the end', () => {
  const v = viewWith({ rom });
  assert.equal(rule.propose(gapCursor(P, P + 0x10, P), v), undefined);
  assert.equal(rule.propose(gapCursor(P, P + 0x0e, P, { head }), v), undefined);
});
