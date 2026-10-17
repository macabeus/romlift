import assert from 'node:assert/strict';
import { test } from 'node:test';

import tilesAfterAccepted from '../../../../../src/core/analysis/rules/accept/tiles-after-accepted.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { Candidate } from '../../../../../src/core/analysis/types.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';

const E = 0x0800_0200;
const c: Candidate = { entry: E, mode: 'thumb', proposedBy: 'seed.data-pointer', cites: [0x0800_0300] };

/** The verdict when claimed code ends `gap` zero bytes before E. */
function holds(gap: number) {
  const rom = romWith([]);
  const v = viewWith({ rom, claims: [{ span: { start: E - 0x20, end: E - gap }, kind: Claim.code }] });
  return tilesAfterAccepted.holds(c, readingOf(rom, { entry: E }), v);
}

test('a candidate right after claimed bytes holds, with its provenance', () => {
  assert.deepEqual(holds(0), { cites: [E, 0x0800_0300], note: 'anchored at start' });
  assert.equal(tilesAfterAccepted.reason, 'unanchored');
});

test('the boundary at anchorSlack: 3 padding bytes still anchor, 4 do not', () => {
  assert.notEqual(holds(2), undefined);
  assert.notEqual(holds(3), undefined);
  assert.equal(holds(4), undefined);
});

test('non-padding bytes before the entry break the anchor', () => {
  const rom = romWith([{ at: E - 2, bytes: Uint8Array.of(0x01, 0x20) }]);
  const v = viewWith({ rom, claims: [{ span: { start: E - 0x20, end: E - 2 }, kind: Claim.code }] });
  assert.equal(tilesAfterAccepted.holds(c, readingOf(rom, { entry: E }), v), undefined);
  assert.equal(tilesAfterAccepted.holds(c, readingOf(rom, { entry: E }), viewWith({ rom })), undefined, 'nothing claimed');
});
