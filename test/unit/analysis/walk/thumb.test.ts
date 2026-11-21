// The Thumb walk skeleton on hand-assembled bytes, with the reference walk policies of
// test/helpers/analysis.ts standing in for the wave-1 walk rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DECODER_FLOW } from '../../../../src/core/analysis/types.ts';
import { isDense, popsCallersFrame } from '../../../../src/core/analysis/walk/predicates.ts';
import { REFERENCE_WALK, romWith, viewWith, walkReading, words } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const F = 0x0800_0200;

test('stack balance: push and pop {pc} cancel; a pop of more than was pushed shows in the balance', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {r4, lr}; sub sp, #8; movs r0, #1; add sp, #8; pop {r4, pc}` },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`push {lr}; pop {r4, pc}` },
  ]);
  const v = viewWith({ rom });
  const ok = walkReading(v, F, 'thumb');
  assert.equal(ok.insns.length, 5);
  assert.deepEqual(ok.balance, [0]);
  assert.equal(ok.returns, 1);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.exits, [{ at: F + 8, kind: 'return', rule: DECODER_FLOW }]);
  assert.equal(popsCallersFrame(ok), false);
  const bad = walkReading(v, F + 0x20, 'thumb');
  assert.deepEqual(bad.balance, [4]);
  assert.equal(popsCallersFrame(bad), true);
});

test('bl: a call goes on, a far site is walked as a jump, a noret site ends its path', () => {
  const code = thumbAt(F)`push {lr}; bl _08000280; pop {pc}`;
  const target = thumbAt(F + 0x80)`movs r0, #0; bx lr`;
  const rom = romWith([
    { at: F, bytes: code },
    { at: F + 0x80, bytes: target },
  ]);
  const v = viewWith({ rom });
  const call = walkReading(v, F, 'thumb');
  assert.deepEqual(call.blSites, [{ site: F + 2, target: F + 0x80 }]);
  assert.deepEqual(call.calls, [{ site: F + 2, target: F + 0x80, mode: 'thumb' }]);
  assert.equal(call.codeEnd, F + 8);
  const far = walkReading(v, F, 'thumb', REFERENCE_WALK, new Set([F + 2]));
  assert.deepEqual(far.blSites, []);
  assert.equal(far.insnAt.has(F + 0x80), true, 'the target is walked as part of the function');
  assert.equal(far.insnAt.has(F + 6), false, 'nothing after a jump');
  const noret = walkReading(v, F, 'thumb', REFERENCE_WALK, new Set(), new Map([[F + 2, 'bl.noreturn-before-noncode']]));
  assert.equal(noret.insnAt.has(F + 6), false);
  assert.deepEqual(noret.exits, [{ at: F + 2, kind: 'noreturn-call', rule: 'bl.noreturn-before-noncode' }]);
});

test('a pool load records the word; walking into it stops, dropping padding, and a bl before it never returns', () => {
  const code = thumbAt(F)`ldr r0, _08000208; bl _08000280; lsls r0, r0, #0`;
  const rom = romWith([
    { at: F, bytes: code },
    { at: F + 8, bytes: words(0x1234_5678) },
    { at: F + 0x80, bytes: thumbAt(F + 0x80)`bx lr` },
  ]);
  const r = walkReading(viewWith({ rom }), F, 'thumb');
  assert.deepEqual(r.pools, [{ addr: F + 8, value: 0x1234_5678 }]);
  assert.equal(r.insnAt.has(F + 6), false, 'the zero halfword before the pool is padding');
  assert.deepEqual(r.deadEnd, [F + 2]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.end, F + 12, 'the adjacent pool is in the extent');
  assert.deepEqual(
    r.exits.map((e) => e.rule),
    ['walk.noreturn-call-before-noncode'],
  );
});

test('without a bl or swi before it, non-code is a decode error; a swi before it ends the path', () => {
  const rom = romWith([
    { at: F, bytes: Uint8Array.from([...thumbAt(F)`movs r0, #0`, 0x00, 0xb1]) },
    { at: F + 0x10, bytes: Uint8Array.from([0x10, 0xdf, 0x00, 0xb1]) },
  ]);
  const v = viewWith({ rom });
  assert.deepEqual(walkReading(v, F, 'thumb').errors, [{ reason: 'not-code', at: F + 2 }]);
  const swi = walkReading(v, F + 0x10, 'thumb');
  assert.deepEqual(swi.errors, []);
  assert.equal(swi.returns, 1);
  assert.deepEqual(
    swi.exits.map((e) => e.kind),
    ['swi-end'],
  );
  assert.deepEqual(walkReading(v, F, 'thumb', []).errors, [{ reason: 'not-code', at: F + 2 }], 'no policies: the same');
});

test('the walk falls into the next function without an error, and a branch into one is a tail exit', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`movs r0, #0; movs r1, #1; beq _08000240; bx lr` },
    { at: F + 0x40, bytes: thumbAt(F + 0x40)`bx lr` },
  ]);
  const v = viewWith({ rom, functions: [F + 2, F + 0x40] });
  const r = walkReading(v, F, 'thumb');
  assert.deepEqual(r.insns, [{ addr: F, len: 2 }]);
  assert.deepEqual(r.errors, []);
  const v2 = viewWith({ rom, functions: [F + 0x40] });
  const t = walkReading(v2, F, 'thumb');
  assert.deepEqual(t.tails, [F + 0x40]);
  assert.equal(t.tailExits, 1);
  assert.equal(t.returns, 2, 'the tail and the bx lr after the conditional branch');
  assert.deepEqual(t.calls, [{ site: F + 4, target: F + 0x40, mode: 'thumb' }]);
});

test('a jump table behind mov pc is walked; bx pc is a veneer; an unexplained mov pc is not code', () => {
  const sw = thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; mov pc, r0`;
  const rom = romWith([
    { at: F, bytes: sw },
    { at: F + 0x0c, bytes: words(F + 0x10) },
    { at: F + 0x10, bytes: words(F + 0x20, F + 0x24, 0) },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`bx lr; bx lr; bx lr` },
    { at: F + 0x40, bytes: thumbAt(F + 0x40)`bx pc` },
    { at: F + 0x60, bytes: thumbAt(F + 0x60)`mov pc, r0` },
  ]);
  const v = viewWith({ rom });
  const r = walkReading(v, F, 'thumb');
  assert.deepEqual(r.tables, [{ base: F + 0x10, targets: [F + 0x20, F + 0x24], thumbBit: false }]);
  assert.equal(r.returns, 2);
  assert.equal(r.end, F + 0x26, 'the pool and the table lie below the code end');
  assert.deepEqual(
    r.holes.map((h) => [h.start - F, h.end - F]),
    [
      [6, 10],
      [0x18, 0x1e],
      [0x22, 0x24],
    ],
    'the bx lr between the two targets is never reached',
  );
  assert.equal(isDense(r, v.profile), false);
  assert.deepEqual(walkReading(v, F + 0x40, 'thumb').veneers, [F + 0x44]);
  assert.deepEqual(
    walkReading(v, F + 0x60, 'thumb').exits.map((e) => [e.kind, e.rule]),
    [['reg-jump', 'walk.mov-pc-without-table']],
  );
  assert.deepEqual(
    walkReading(v, F + 0x60, 'thumb', []).errors,
    [{ reason: 'not-code', at: F + 0x60 }],
    'no policy: not code',
  );
});

test('out of the ROM and a bl out of the ROM are decode errors', () => {
  const rom = romWith([{ at: 0x0800_03fe, bytes: thumbAt(0x0800_03fe)`movs r0, #0` }]);
  const v = viewWith({ rom });
  assert.deepEqual(walkReading(v, 0x0800_03fe, 'thumb').errors, [{ reason: 'out-of-rom', at: 0x0800_0400 }]);
  const rom2 = romWith([{ at: F, bytes: thumbAt(F)`bl _08100000` }]);
  assert.deepEqual(walkReading(viewWith({ rom: rom2 }), F, 'thumb').errors, [{ reason: 'bl-out-of-rom', at: F }]);
});
