// walk.swi-before-noncode: a swi followed by non-code ends the path as a return (analyzeThumb's
// "a BIOS call that never returns").
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romWith, viewWith, walkReading } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.swi-before-noncode';
const INVALID = Uint8Array.from([0x00, 0xb1]);

test('a swi before non-code counts a return, with no stack balance, and no error', () => {
  const rom = romWith([{ at: F, bytes: Uint8Array.from([...thumbAt(F)`push {lr}; swi #0`, ...INVALID]) }]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.equal(r.returns, 1);
  assert.deepEqual(r.balance, [], 'the PoC pushes no balance for it');
  assert.deepEqual(r.exits, [{ at: F + 2, kind: 'swi-end', rule: ID }]);
  assert.deepEqual(r.errors, []);
  const bare = walkReading(v, F, 'thumb', without(ID));
  assert.equal(bare.returns, 0);
  assert.deepEqual(bare.errors, [{ reason: 'not-code', at: F + 4 }]);
});

test('a swi in the middle of a run is an ordinary instruction', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`swi #5; movs r0, #0; bx lr` }]);
  const r = walkReading(viewWith({ rom }), F, 'thumb', WALK);
  assert.equal(r.insns.length, 3);
  assert.deepEqual(r.exits.map((e) => e.kind), ['return']);
});

test('declines: the insn phase, an instruction other than swi, and ARM', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`swi #0; movs r0, #1` }]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  const swi = insnAt(rom, F, 'thumb');
  assert.deepEqual(rule.onInsn(swi, cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'invalid' })), { step: 'end-path', exit: 'swi-end' });
  assert.equal(rule.onInsn(swi, cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(rule.onInsn(insnAt(rom, F + 2, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'invalid' })), undefined);
  assert.equal(rule.onInsn(swi, cursorOf(v, { entry: F, mode: 'arm', phase: 'stop' })), undefined);
});
