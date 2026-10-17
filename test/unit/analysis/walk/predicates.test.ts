// The reading queries several rule families share: anchoring, density, frame balance, filling.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Claim } from '../../../../src/core/analysis/types.ts';
import { anchoredAtEnd, anchoredAtStart, fillsTo, isDense, popsCallersFrame, readingSummary } from '../../../../src/core/analysis/walk/predicates.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const A = 0x0800_0200;

test('anchored at start: claimed bytes end just below the entry, give or take three padding bytes', () => {
  const rom = romWith([{ at: A, bytes: Uint8Array.from([0x70, 0x47, 0, 0, 0xc0, 0x46, 0x70, 0x47]) }]);
  const v = viewWith({ rom, claims: [{ span: { start: A, end: A + 2 }, kind: Claim.code }] });
  assert.equal(anchoredAtStart(A + 2, v), true);
  assert.equal(anchoredAtStart(A + 4, v), true, 'two zero bytes');
  assert.equal(anchoredAtStart(A + 6, v), false, 'four padding bytes are more than the slack');
  assert.equal(anchoredAtStart(A + 0x40, v), false);
});

test('anchored at end: a function starts within three padding bytes of the extent end', () => {
  const rom = romWith([{ at: A, bytes: Uint8Array.from([0x70, 0x47, 0, 0, 0x70, 0x47]) }]);
  const r = readingOf(rom, { entry: A, insns: [{ addr: A, len: 2 }] });
  assert.equal(anchoredAtEnd(r, viewWith({ rom, functions: [A + 4] })), true);
  assert.equal(anchoredAtEnd(r, viewWith({ rom, functions: [A + 6] })), false);
  assert.equal(anchoredAtEnd(r, viewWith({ rom })), false);
});

test('density, frame balance, filling and the far-jump summary', () => {
  const rom = romWith([{ at: A, bytes: thumbAt(A)`push {lr}; pop {pc}` }]);
  const r = readingOf(rom, { entry: A, insns: [{ addr: A, len: 2 }, { addr: A + 2, len: 2 }], balance: [0, 4] });
  assert.equal(isDense(r, AGBCC), true);
  assert.equal(popsCallersFrame(r), true);
  assert.equal(fillsTo(r, A + 7, 3), true);
  assert.equal(fillsTo(r, A + 8, 3), false);
  assert.equal(fillsTo(r, A + 3, 3), false);
  assert.deepEqual(readingSummary(r, rom, AGBCC), { entry: A, mode: 'thumb', codeEnd: A + 4, end: A + 4, prologue: true });
  const sparse = readingOf(rom, { entry: A, insns: [{ addr: A, len: 2 }], end: A + 0x40 });
  assert.equal(isDense(sparse, AGBCC), false);
});
