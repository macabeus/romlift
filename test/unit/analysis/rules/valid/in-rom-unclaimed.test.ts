import assert from 'node:assert/strict';
import { test } from 'node:test';

import inRomUnclaimed from '../../../../../src/core/analysis/rules/valid/in-rom-unclaimed.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import { BASE, readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';

const E = 0x0800_0200;

test('an even, unclaimed ROM entry passes, before any reading exists', () => {
  const rom = romWith([], { size: 0x400 });
  const v = viewWith({ rom, claims: [{ span: { start: E - 4, end: E }, kind: Claim.code }] });
  assert.equal(inRomUnclaimed.checkEntry?.(E, v), undefined);
  assert.equal(inRomUnclaimed.checkEntry?.(BASE, v), undefined, 'the first byte is in');
  assert.equal(inRomUnclaimed.checkEntry?.(rom.end - 2, v), undefined, 'the last halfword is in');
  assert.equal(inRomUnclaimed.check(readingOf(rom, { entry: E }), v), undefined);
});

test('outside the ROM or odd fails as inside-code, intrinsically', () => {
  const rom = romWith([], { size: 0x400 });
  const v = viewWith({ rom });
  assert.equal(inRomUnclaimed.checkEntry?.(BASE - 2, v), 'outside the ROM');
  assert.equal(inRomUnclaimed.checkEntry?.(rom.end, v), 'outside the ROM');
  assert.equal(inRomUnclaimed.checkEntry?.(E + 1, v), 'outside the ROM');
  assert.equal(inRomUnclaimed.reason, 'inside-code');
  assert.equal(inRomUnclaimed.intrinsic, true);
});

test('a claimed entry fails, whatever the claim', () => {
  const rom = romWith([]);
  for (const kind of [Claim.code, Claim.pool, Claim.padding, Claim.dead]) {
    const v = viewWith({ rom, claims: [{ span: { start: E, end: E + 2 }, kind }] });
    assert.equal(inRomUnclaimed.checkEntry?.(E, v), 'inside claimed bytes');
    assert.equal(inRomUnclaimed.check(readingOf(rom, { entry: E }), v), 'inside claimed bytes');
  }
});
