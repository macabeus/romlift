import assert from 'node:assert/strict';
import { test } from 'node:test';

import prologueAndEndAnchored from '../../../../../src/core/analysis/rules/accept/prologue-and-end-anchored.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { Candidate } from '../../../../../src/core/analysis/types.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';

const E = 0x0800_0200;
const END = E + 6;
const c: Candidate = { entry: E, mode: 'thumb', proposedBy: 'seed.data-pointer', cites: [0x0800_0300] };

/** The verdict when the next accepted function (its bytes claimed as code) starts `gap` zero bytes after the extent. */
function holds(gap: number, code = 'push {r4, lr}; movs r4, #0; pop {r4, pc}') {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`${code}` }]);
  const r = readingOf(rom, { entry: E, insns: [{ addr: E, len: 2 }, { addr: E + 2, len: 2 }, { addr: E + 4, len: 2 }] });
  const next = END + gap;
  return prologueAndEndAnchored.holds(c, r, viewWith({ rom, functions: [next], claims: [{ span: { start: next, end: next + 4 }, kind: Claim.code }] }));
}

test('a prologue whose extent ends at an accepted function holds', () => {
  assert.deepEqual(holds(0), { cites: [E, END, 0x0800_0300], note: 'prologue, anchored at end' });
  assert.equal(prologueAndEndAnchored.reason, 'unanchored');
});

test('the boundary at anchorSlack: a function 3 padding bytes after the extent anchors it, 4 do not', () => {
  assert.notEqual(holds(2), undefined);
  assert.notEqual(holds(3), undefined);
  assert.equal(holds(4), undefined);
});

test('without a prologue an end anchor is not enough', () => {
  assert.equal(holds(0, 'push {r4}; movs r4, #0; pop {r4}'), undefined);
});
