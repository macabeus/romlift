// walk.noreturn-call-before-noncode: a bl followed by non-code never returns (analyzeThumb
// `f.deadEnd.add(last)`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const T = 0x0800_0280;
const ID = 'walk.noreturn-call-before-noncode';
const INVALID = Uint8Array.from([0x00, 0xb1]);

test('a bl before an undecodable halfword ends the path: a dead end, an exit, no error', () => {
  const rom = romWith([{ at: F, bytes: Uint8Array.from([...thumbAt(F)`push {lr}; bl _08000280`, ...INVALID]) }, { at: T, bytes: thumbAt(T)`bx lr` }]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(r.deadEnd, [F + 2]);
  assert.deepEqual(r.exits, [{ at: F + 2, kind: 'noreturn-call', rule: ID }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.returns, 0);
  assert.deepEqual(r.blSites, [{ site: F + 2, target: T }]);
  assert.deepEqual(walkReading(v, F, 'thumb', without(ID)).errors, [{ reason: 'not-code', at: F + 6 }]);
});

test('a bl before its own pool word ends the path the same way', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`ldr r0, _08000208; bl _08000280; movs r0, #0` }, { at: F + 8, bytes: words(1) }, { at: T, bytes: thumbAt(T)`bx lr` }]);
  const r = walkReading(viewWith({ rom }), F, 'thumb', WALK);
  assert.deepEqual(r.deadEnd, []);
  assert.deepEqual(r.errors, [{ reason: 'not-code', at: F + 8 }], 'movs r0, #0 is no padding, so the bl is not last');
  const tight = romWith([{ at: F, bytes: thumbAt(F)`ldr r0, _08000208; movs r0, #1; bl _08000280` }, { at: F + 8, bytes: words(1) }, { at: T, bytes: thumbAt(T)`bx lr` }]);
  assert.deepEqual(walkReading(viewWith({ rom: tight }), F, 'thumb', WALK).deadEnd, [F + 4]);
});

test('declines: the insn phase, an instruction other than bl, and ARM', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`bl _08000280; movs r0, #1` }]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  const bl = insnAt(rom, F, 'thumb');
  assert.deepEqual(rule.onInsn(bl, cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'pool' })), { step: 'end-path', exit: 'noreturn-call' });
  assert.equal(rule.onInsn(bl, cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(rule.onInsn(insnAt(rom, F + 4, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'pool' })), undefined);
  assert.equal(rule.onInsn(bl, cursorOf(v, { entry: F, mode: 'arm', phase: 'stop' })), undefined);
});
