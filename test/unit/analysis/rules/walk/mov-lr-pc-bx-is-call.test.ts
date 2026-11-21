// walk.mov-lr-pc-bx-is-call: ARM `mov lr, pc; bx rN` is a call (analyzeArm `prev === MOV_LR_PC`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DECODER_FLOW } from '../../../../../src/core/analysis/types.ts';
import { romWith, viewWith, walkReading } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { WALK, cursorOf, insnAt, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.mov-lr-pc-bx-is-call';

test('mov lr, pc then bx rN is a call: the path goes on to the return after it', () => {
  const rom = romWith([{ at: F, bytes: armAt(F)`mov lr, pc; bx r1; mov r0, #0; bx lr` }]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'arm', WALK);
  assert.equal(r.insns.length, 4);
  assert.equal(r.returns, 1);
  assert.deepEqual(r.exits, [{ at: F + 12, kind: 'return', rule: DECODER_FLOW }]);
  const run = [insnAt(rom, F, 'arm'), insnAt(rom, F + 4, 'arm')];
  assert.deepEqual(walkRule(ID).onInsn(run[1]!, cursorOf(v, { entry: F, mode: 'arm', run })), { step: 'continue' });
  const bare = walkReading(v, F, 'arm', without(ID));
  assert.equal(bare.insns.length, 2, 'without the rule the bx is a register jump that ends the path');
  assert.deepEqual(
    bare.exits.map((e) => e.kind),
    ['reg-jump'],
  );
});

test('the bx may name any register, lr included, and may be conditional', () => {
  const rom = romWith([
    { at: F, bytes: armAt(F)`mov lr, pc; bx lr; bx lr` },
    { at: F + 0x20, bytes: armAt(F + 0x20)`mov lr, pc; bxne r3; bx lr` },
  ]);
  const v = viewWith({ rom });
  assert.equal(walkReading(v, F, 'arm', WALK).insns.length, 3);
  const cond = walkReading(v, F + 0x20, 'arm', WALK);
  assert.equal(cond.insns.length, 3);
  assert.equal(cond.returns, 1);
});

test('declines: another instruction before the bx, a conditional mov lr, pc, Thumb, and a bx starting a new path', () => {
  const rom = romWith([
    { at: F, bytes: armAt(F)`mov r0, r0; bx r1; bx lr` },
    { at: F + 0x20, bytes: armAt(F + 0x20)`movne lr, pc; bx r1; bx lr` },
    { at: F + 0x40, bytes: armAt(F + 0x40)`mov lr, pc; b _08000250; mov r0, r0; mov r0, r0; bx r1; bx lr` },
    { at: F + 0x80, bytes: thumbAt(F + 0x80)`mov lr, pc; bx r1` },
  ]);
  const v = viewWith({ rom });
  const ends = (entry: number): number => walkReading(v, entry, 'arm', WALK).insns.length;
  assert.equal(ends(F), 2);
  assert.equal(ends(F + 0x20), 2);
  assert.equal(
    walkReading(v, F + 0x40, 'arm', WALK).insnAt.has(F + 0x54),
    false,
    'the bx after the branch has no previous instruction in its run',
  );
  const thumbRun = [insnAt(rom, F + 0x80, 'thumb'), insnAt(rom, F + 0x82, 'thumb')];
  assert.equal(
    walkRule(ID).onInsn(thumbRun[1]!, cursorOf(v, { entry: F + 0x80, mode: 'thumb', run: thumbRun })),
    undefined,
  );
});
