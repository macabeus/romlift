// walk.inline-arm-switch: Thumb `adr rN, L; bx rN` with L the first word after the bx makes the ARM code at
// L the function's tail: the reading records it (armTails) and claim.adjacent-pools' extent covers it,
// while its bytes stay unwalked by the Thumb walk; the Thumb path ends as a register jump. m4a's
// umul3232H32 at a word boundary, and SoundMainRAM's entry at a halfword one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Addr } from '../../../../../src/foundation/rom/span.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import adjacentPools from '../../../../../src/core/analysis/rules/claim/adjacent-pools.ts';
import type { Reading } from '../../../../../src/core/analysis/types.ts';
import { walkThumb } from '../../../../../src/core/analysis/walk/thumb.ts';
import type { ResolvedPolicy, WalkEnv } from '../../../../../src/core/analysis/walk/cursor.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { romWith, viewWith } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.inline-arm-switch';
const BODY = (at: Addr): Uint8Array => armAt(at)`umull r2, r3, r0, r1; add r0, r3, #0; bx lr`;

function walk(rom: Rom, entry: Addr, policies: readonly ResolvedPolicy[] = WALK): Reading {
  const extentEnd = adjacentPools.extentEnd;
  assert.ok(extentEnd !== undefined);
  const env: WalkEnv = { view: viewWith({ rom }), policies, extentEnd: (shape) => extentEnd(shape, AGBCC) };
  return walkThumb(env, entry, new Set(), new Map());
}

test("umul3232H32: the ARM body after `adr r2, L; bx r2` (add r2, pc, #0) is the function's tail, inside its extent", () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`adr r2, _08000204; bx r2` }, { at: F + 4, bytes: BODY(F + 4) }]);
  const r = walk(rom, F);
  assert.deepEqual(r.armTails, [{ start: F + 4, end: F + 16 }]);
  assert.equal(r.codeEnd, F + 4, 'the Thumb walk itself stops at the bx');
  assert.equal(r.end, F + 16, 'the extent covers the ARM body');
  assert.deepEqual(r.exits.map((e) => [e.at, e.kind, e.rule]), [[F + 2, 'reg-jump', ID]]);
  // Without the rule the bx is a register jump of the decoder and the extent ends at it.
  const bare = walk(rom, F, without(ID));
  assert.deepEqual(bare.armTails, []);
  assert.equal(bare.end, F + 4);
});

test('a halfword-aligned entry: `adr r1, L; bx r1` (add r1, pc, #4) reaches the ARM code at the next word boundary', () => {
  const at = F + 2;
  const rom = romWith([{ at, bytes: thumbAt(at)`adr r1, _08000208; bx r1` }, { at: F + 8, bytes: BODY(F + 8) }]);
  assert.deepEqual(walk(rom, at).armTails, [{ start: F + 8, end: F + 20 }]);
});

test('declines: another register, a target that is not the next word, no adr before the bx, ARM, the stop phase', () => {
  const rule = walkRule(ID);
  const rom = romWith([{ at: F, bytes: thumbAt(F)`adr r2, _08000204; bx r3; adr r2, _08000210; bx r2; movs r2, #0; bx r2` }, { at: F + 0x40, bytes: armAt(F + 0x40)`bx r2` }]);
  const v = viewWith({ rom });
  const ask = (adr: Addr, bx: Addr, over: Record<string, unknown> = {}): unknown => {
    const run = [insnAt(rom, adr, 'thumb'), insnAt(rom, bx, 'thumb')];
    return rule.onInsn(run[1]!, cursorOf(v, { entry: adr, mode: 'thumb', run, ...over }));
  };
  assert.deepEqual(ask(F, F + 2, {}), undefined, 'the adr sets r2, the bx reads r3');
  assert.equal(ask(F + 4, F + 6), undefined, 'adr names F + 0x10, not the next word');
  assert.equal(ask(F + 8, F + 10), undefined, 'movs is no adr');
  const bx = insnAt(rom, F + 6, 'thumb');
  assert.equal(rule.onInsn(bx, cursorOf(v, { entry: F + 6, mode: 'thumb', run: [bx] })), undefined, 'nothing before the bx');
  const adr = insnAt(rom, F + 4, 'thumb');
  assert.equal(rule.onInsn(bx, cursorOf(v, { entry: F + 4, mode: 'thumb', run: [adr, bx], phase: 'stop' })), undefined);
  const arm = insnAt(rom, F + 0x40, 'arm');
  assert.equal(rule.onInsn(arm, cursorOf(v, { entry: F + 0x40, mode: 'arm', run: [arm] })), undefined);
});

test('an ARM tail that does not decode to a returning walk is not recorded', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`adr r2, _08000204; bx r2` }, { at: F + 4, bytes: Uint8Array.from([0xff, 0xff, 0xff, 0xff]) }]);
  const r = walk(rom, F);
  assert.deepEqual(r.armTails, []);
  assert.equal(r.end, F + 4);
});
