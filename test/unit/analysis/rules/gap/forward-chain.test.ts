// gap.forward-chain: a valid Thumb reading at the cursor with a nonzero first word and its extent inside
// [gap start, end); tiny readings are proposed (the accept slot's veto judges them).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/forward-chain.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const P = 0x0800_0200;
const END = 0x0800_0240;
const rom = romWith([
  { at: P, bytes: thumbAt(P)`movs r0, #0; movs r1, #1; bx lr` },
  { at: P + 8, bytes: words(0x1234_5678) },
  { at: P + 0x10, bytes: thumbAt(P + 0x10)`bx lr` },
  { at: P + 0x20, bytes: words(0) },
]);

test('a valid reading inside the gap is proposed', () => {
  assert.deepEqual(rule.propose(gapCursor(P, END, P), viewWith({ rom })), { entry: P, mode: 'thumb', cites: [P, P + 6] });
  assert.equal(rule.propose(gapCursor(P, END, P + 0x10), viewWith({ rom }))?.entry, P + 0x10, 'a one-instruction stub too: the veto is the accept slot\'s');
});

test('declined: a function, a zero first word, or an invalid entry', () => {
  assert.equal(rule.propose(gapCursor(P, END, P), viewWith({ rom, functions: [P] })), undefined);
  assert.equal(rule.propose(gapCursor(P, END, P + 0x20), viewWith({ rom })), undefined);
  assert.equal(rule.propose(gapCursor(P, END, P), viewWith({ rom, valid: () => false })), undefined);
});

test('declined: an extent past the current end, or a cursor below the gap start', () => {
  assert.equal(rule.propose(gapCursor(P, P + 6, P), viewWith({ rom }))?.entry, P, 'ending exactly at the end');
  assert.equal(rule.propose(gapCursor(P, P + 4, P), viewWith({ rom })), undefined);
  assert.equal(rule.propose(gapCursor(P + 2, END, P), viewWith({ rom })), undefined);
});
