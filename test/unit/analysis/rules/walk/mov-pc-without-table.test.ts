// walk.mov-pc-without-table: a computed jump no table explains ends the path as a register jump
// (analyzeThumb `mov_pc` with no target, analyzeArm `pc_write`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DECODER_FLOW } from '../../../../../src/core/analysis/types.ts';
import { romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.mov-pc-without-table';

test('Thumb mov pc, rN and add pc, rN end the path as a register jump, with the stack balance', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {r4, lr}; mov pc, r0` },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`add pc, r1` },
  ]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(r.exits, [{ at: F + 2, kind: 'reg-jump', rule: ID }]);
  assert.equal(r.returns, 1);
  assert.deepEqual(r.balance, [-8]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(walkReading(v, F + 0x20, 'thumb', WALK).exits.map((e) => e.rule), [ID]);
  assert.deepEqual(walkReading(v, F, 'thumb', without(ID)).errors, [{ reason: 'not-code', at: F + 2 }], 'without the rule: not code');
});

test('ARM writes to pc: mov, ldr through a register, ldm; a conditional one counts and the path goes on', () => {
  const rom = romWith([
    { at: F, bytes: armAt(F)`mov pc, r0` },
    { at: F + 0x10, bytes: armAt(F + 0x10)`ldr pc, [r0]` },
    { at: F + 0x20, bytes: armAt(F + 0x20)`ldmia r0, {r4, pc}` },
    { at: F + 0x30, bytes: armAt(F + 0x30)`movne pc, r0; bx lr` },
  ]);
  const v = viewWith({ rom });
  for (const at of [F, F + 0x10, F + 0x20]) {
    const r = walkReading(v, at, 'arm', WALK);
    assert.deepEqual(r.exits, [{ at, kind: 'reg-jump', rule: ID }], `0x${at.toString(16)}`);
    assert.deepEqual(r.errors, []);
  }
  const cond = walkReading(v, F + 0x30, 'arm', WALK);
  assert.equal(cond.returns, 2);
  assert.equal(cond.insns.length, 2);
  assert.deepEqual(walkReading(v, F + 0x10, 'arm', without(ID)).errors, [{ reason: 'not-code', at: F + 0x10 }]);
});

test('declines: bx rN (the decoder ends it), returns, and a table jump the table rule took first', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`bx r0; mov pc, lr` },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`ldr r1, _0800022C; ldr r0, [r1, r0]; mov pc, r0` },
    { at: F + 0x2c, bytes: words(F + 0x30, F + 0x40, 0) },
    { at: F + 0x40, bytes: thumbAt(F + 0x40)`bx lr` },
  ]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  assert.equal(rule.onInsn(insnAt(rom, F, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(rule.onInsn(insnAt(rom, F + 2, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.deepEqual(walkReading(v, F, 'thumb', WALK).exits, [{ at: F, kind: 'reg-jump', rule: DECODER_FLOW }]);
  const table = walkReading(v, F + 0x20, 'thumb', WALK);
  assert.deepEqual(table.tables.map((t) => t.targets), [[F + 0x40]]);
  assert.equal(table.exits.some((e) => e.rule === ID), false);
});
