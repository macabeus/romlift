// walk.branch-into-function: a branch into a function or claimed code is a tail exit (analyzeThumb and
// analyzeArm `foreign`); ARM also below the entry.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Claim } from '../../../../../src/core/analysis/types.ts';
import { romWith, viewWith, walkReading } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const G = 0x0800_0240;
const ID = 'walk.branch-into-function';

test('Thumb b to an accepted function is a tail call: an exit, a tail target and a call', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {r0}; b _08000240` }, { at: G, bytes: thumbAt(G)`bx lr` }]);
  const v = viewWith({ rom, functions: [G] });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(r.exits, [{ at: F + 4, kind: 'tail', rule: ID }]);
  assert.deepEqual(r.tails, [G]);
  assert.equal(r.tailExits, 1);
  assert.deepEqual(r.balance, [0]);
  assert.deepEqual(r.calls, [{ site: F + 4, target: G, mode: 'thumb' }]);
  assert.equal(r.insnAt.has(G), false);
  const bare = walkReading(v, F, 'thumb', without(ID));
  assert.deepEqual(bare.tails, []);
  assert.equal(bare.returns, 0, 'without the rule the walk follows the branch and stops at the function');
});

test('a bcc into claimed code is a tail exit and the path goes on; no call when the target is no function', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`cmp r0, #0; beq _08000240; bx lr` }, { at: G, bytes: thumbAt(G)`bx lr` }]);
  const v = viewWith({ rom, claims: [{ span: { start: G, end: G + 2 }, kind: Claim.code }] });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.equal(r.returns, 2);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.exits.map((e) => [e.at - F, e.kind]), [[2, 'tail'], [4, 'return']]);
});

test('declines: the entry, a target already walked, a free or pool-claimed target, and Thumb below the entry', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`movs r0, #1; subs r0, #1; bne _08000202; b _08000200` }, { at: G, bytes: thumbAt(G)`bx lr; b _08000240` }]);
  const v = viewWith({ rom, claims: [{ span: { start: F, end: F + 8 }, kind: Claim.code }], functions: [F] });
  const rule = walkRule(ID);
  const loop = insnAt(rom, F + 4, 'thumb');
  assert.equal(rule.onInsn(loop, cursorOf(v, { entry: F, mode: 'thumb', walked: (a) => a === F + 2 })), undefined, 'walked');
  assert.equal(rule.onInsn(insnAt(rom, F + 6, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined, 'the entry');
  assert.deepEqual(rule.onInsn(loop, cursorOf(v, { entry: F, mode: 'thumb' })), { step: 'end-path', exit: 'tail' }, 'claimed and not walked');
  const pool = viewWith({ rom, claims: [{ span: { start: G, end: G + 4 }, kind: Claim.pool }] });
  assert.equal(rule.onInsn(insnAt(rom, G + 2, 'thumb'), cursorOf(pool, { entry: G + 2, mode: 'thumb' })), undefined, 'a pool-claimed target is not code');
  const back = romWith([{ at: F, bytes: thumbAt(F)`bx lr` }, { at: G, bytes: thumbAt(G)`b _08000200` }]);
  const r = walkReading(viewWith({ rom: back }), G, 'thumb', WALK);
  assert.equal(r.insnAt.has(F), true, 'Thumb follows a branch below the entry into free code');
  assert.equal(walkReading(viewWith({ rom: back, claims: [{ span: { start: F, end: F + 2 }, kind: Claim.pool }] }), G, 'thumb', WALK).insnAt.has(F), true, 'pool is not code');
});

test('ARM: a branch below the entry is a tail exit even into free bytes; one above into a function too', () => {
  const rom = romWith([
    { at: F, bytes: armAt(F)`bx lr` },
    { at: G, bytes: armAt(G)`cmp r0, #0; beq _08000200; b _08000280` },
    { at: G + 0x40, bytes: armAt(G + 0x40)`bx lr` },
  ]);
  const v = viewWith({ rom, functions: [G + 0x40] });
  const r = walkReading(v, G, 'arm', WALK);
  assert.deepEqual(r.exits.map((e) => [e.at - G, e.kind, e.rule]), [[4, 'tail', ID], [8, 'tail', ID]]);
  assert.deepEqual(r.calls, [{ site: G + 8, target: G + 0x40, mode: 'arm' }]);
  assert.equal(r.insnAt.has(F), false);
  assert.equal(walkReading(v, G, 'arm', without(ID)).insnAt.has(F), true, 'without the rule the walk goes below the entry');
});
