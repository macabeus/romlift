// walk.pc-load-is-pool: a pc-relative load records its pool word (analyzeThumb/analyzeArm `ldr_pc`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { WALK, cursorOf, insnAt, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.pc-load-is-pool';

test('a Thumb pc-relative load records the pool word and its value; the path goes on', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`ldr r0, _08000208; ldr r1, _0800020C; bx lr` },
    { at: F + 8, bytes: words(0x1234_5678, 0x0800_0301) },
  ]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(r.pools, [
    { addr: F + 8, value: 0x1234_5678 },
    { addr: F + 12, value: 0x0800_0301 },
  ]);
  assert.equal(r.insns.length, 3);
  assert.deepEqual(r.errors, []);
  assert.equal(r.end, F + 16, 'the adjacent pool is in the extent');
  assert.deepEqual(walkRule(ID).onInsn(insnAt(rom, F, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), {
    step: 'pool',
    addr: F + 8,
  });
});

test('a Thumb pool word must fit in the ROM: the last word is a pool, one past it is a decode error', () => {
  const end = 0x0800_0400;
  const fits = romWith([{ at: end - 8, bytes: thumbAt(end - 8)`ldr r0, _080003FC; bx lr` }], { size: 0x400 });
  const r = walkReading(viewWith({ rom: fits }), end - 8, 'thumb', WALK);
  assert.deepEqual(
    r.pools.map((p) => p.addr),
    [end - 4],
  );
  assert.deepEqual(r.errors, []);
  const past = romWith([{ at: end - 8, bytes: thumbAt(end - 8)`ldr r0, _08000400; bx lr` }], { size: 0x400 });
  const bad = walkReading(viewWith({ rom: past }), end - 8, 'thumb', WALK);
  assert.deepEqual(bad.pools, []);
  assert.deepEqual(bad.errors, [{ reason: 'pool-out-of-rom', at: end - 8 }]);
});

test('ARM: a pool in the ROM is recorded, one outside it is not and the path goes on; ldr pc, [pc] is a pool load', () => {
  const end = 0x0800_0400;
  const rom = romWith(
    [
      { at: F, bytes: armAt(F)`ldr r0, _08000220; ldr pc, _08000224` },
      { at: F + 0x20, bytes: words(5, 6) },
      { at: end - 8, bytes: armAt(end - 8)`ldr r0, _08000400; bx lr` },
    ],
    { size: 0x400 },
  );
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'arm', WALK);
  assert.deepEqual(r.pools, [
    { addr: F + 0x20, value: 5 },
    { addr: F + 0x24, value: 6 },
  ]);
  const out = walkReading(v, end - 8, 'arm', WALK);
  assert.deepEqual(out.pools, []);
  assert.deepEqual(out.errors, []);
  assert.equal(out.returns, 1, 'the bx lr after the load is reached');
});

test('declines: an instruction that loads no pool, and the stop phase; without the rule the word is walked as code', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`ldr r0, _08000204; movs r1, #1` },
    { at: F + 4, bytes: words(0x0000_4770) },
  ]);
  const v = viewWith({ rom });
  const rule = walkRule(ID);
  assert.equal(rule.onInsn(insnAt(rom, F + 2, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb' })), undefined);
  assert.equal(
    rule.onInsn(insnAt(rom, F, 'thumb'), cursorOf(v, { entry: F, mode: 'thumb', phase: 'stop', stop: 'invalid' })),
    undefined,
  );
  const r = walkReading(v, F, 'thumb', WALK);
  assert.deepEqual(r.pools, [{ addr: F + 4, value: 0x4770 }]);
  assert.deepEqual(r.errors, [{ reason: 'not-code', at: F + 4 }], 'falling into its own pool word stops the path');
  const bare = walkReading(v, F, 'thumb', without(ID));
  assert.deepEqual(bare.pools, []);
  assert.deepEqual(bare.errors, []);
  assert.equal(bare.returns, 1, 'without the rule the pool word decodes as bx lr');
});
