// walk.bx-pc-veneer: Thumb `bx pc` names the ARM veneer at (pc + 4) & ~3 and ends the path
// (analyzeThumb `bx` with register 15).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DECODER_FLOW } from '../../../../../src/core/analysis/types.ts';
import { romWith, viewWith, walkReading } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { WALK, cursorOf, insnAt, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.bx-pc-veneer';

test('bx pc on a word boundary and after a nop both name the next word as an ARM veneer', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`bx pc` },
    { at: F + 4, bytes: armAt(F + 4)`bx lr` },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`mov r8, r8; bx pc` },
    { at: F + 0x24, bytes: armAt(F + 0x24)`bx lr` },
  ]);
  const v = viewWith({ rom });
  const aligned = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(aligned.veneers, [F + 4]);
  assert.deepEqual(aligned.exits, [{ at: F, kind: 'return', rule: ID }]);
  assert.deepEqual(aligned.balance, [0]);
  const nop = walkReading(v, F + 0x20, 'thumb', WALK);
  assert.deepEqual(nop.veneers, [F + 0x24], '(F + 0x22 + 4) & ~3');
  assert.equal(nop.insnAt.has(F + 0x24), false, 'the ARM word is not walked as Thumb');
  assert.deepEqual(
    walkRule(ID).onInsn(insnAt(rom, F + 0x22, 'thumb'), cursorOf(v, { entry: F + 0x20, mode: 'thumb' })),
    { step: 'switch-mode', target: F + 0x24 },
  );
});

test('declines: bx rN and bx lr; without the rule bx pc is a plain return and names no veneer', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`bx r0; bx lr; bx pc` }]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  assert.equal(rule.onInsn(insnAt(rom, F, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(rule.onInsn(insnAt(rom, F + 2, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  const bare = walkReading(v, F + 4, 'thumb', without(ID));
  assert.deepEqual(bare.veneers, []);
  assert.deepEqual(bare.exits, [{ at: F + 4, kind: 'return', rule: DECODER_FLOW }]);
});
