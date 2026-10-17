// claim.dead-code-in-extent: a dense reading's free bytes in [entry, end) become dead code (claim():
// `if (this.dense(f))`), with the density numbers at their boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLAIM_RULES } from '../../../../../src/core/analysis/rules/claim/index.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { Reading } from '../../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import { readingOf, romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { driverOver } from '../bl/support.ts';
import { claimsOf, factOf, run, take } from './support.ts';

const F = 0x0800_0200;
const rule = CLAIM_RULES['claim.dead-code-in-extent'];
const FILLED = romWith([{ at: F, bytes: new Uint8Array(0x200).fill(0xff) }]);

/** A reading of two instructions `gap` bytes apart over nonzero bytes: `gap` hole bytes in an extent of gap + 4. */
function spaced(rom: Rom, gap: number): Reading {
  return readingOf(rom, { entry: F, insns: [{ addr: F, len: 2 }, { addr: F + 2 + gap, len: 2 }] });
}

test('minHoles (8): 8 hole bytes are dense and become dead, 10 are not and stay free', () => {
  assert.deepEqual(AGBCC.density, { minHoles: 8, holeShift: 4 });
  const v = viewWith({ rom: FILLED });
  const dense = spaced(FILLED, 8);
  assert.equal(dense.holeBytes, 8);
  assert.deepEqual(rule.claims(factOf(dense), dense, v), [{ span: { start: F, end: F + 12 }, kind: Claim.dead, when: 'free-bytes' }]);
  const sparse = spaced(FILLED, 10);
  assert.equal(sparse.holeBytes, 10);
  assert.deepEqual(rule.claims(factOf(sparse), sparse, v), []);
});

test('holeShift (4): an extent of 0x100 bytes may hold 16 hole bytes, not 18', () => {
  const v = viewWith({ rom: FILLED });
  const at = (holes: number): Reading =>
    readingOf(FILLED, { entry: F, insns: [{ addr: F, len: 0x100 - 2 - holes }, { addr: F + 0xfe, len: 2 }] });
  assert.equal(at(16).holeBytes, 16);
  assert.equal(rule.claims(factOf(at(16)), at(16), v).length, 1);
  assert.equal(at(18).holeBytes, 18);
  assert.deepEqual(rule.claims(factOf(at(18)), at(18), v), []);
});

test('declines: an empty reading', () => {
  const r = readingOf(FILLED, { entry: F });
  assert.deepEqual(rule.claims(factOf(r), r, viewWith({ rom: FILLED })), []);
});

test('through accept: the unreached arm and the padding become dead; the claimed bytes keep their claim', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`ldr r0, _08000210; cmp r0, #0; b _08000208; movs r0, #1; bx lr` },
    { at: F + 0x10, bytes: words(5) },
  ]);
  const s = driverOver(rom);
  take(s, F);
  assert.deepEqual(claimsOf(s, F, F + 0x14), [
    ...run(Claim.code, 6),
    ...run(Claim.dead, 2),
    ...run(Claim.code, 2),
    ...run(Claim.dead, 6),
    ...run(Claim.pool, 4),
  ]);
  const without = driverOver(rom, 'claim.dead-code-in-extent');
  take(without, F);
  assert.deepEqual(claimsOf(without, F + 6, F + 8), run(Claim.free, 2));
});
