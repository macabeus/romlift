// seed.ram-copy (D60 e): a copy of a ROM block to IWRAM by accepted code, and the IWRAM pointers accepted
// code jumps through, name entries of the block at their load addresses; each pair is proposed when the
// later of the two functions is accepted.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/seed/ram-copy.ts';
import type { AnalysisView, Reading } from '../../../../../src/core/analysis/types.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { factOf } from './fact.ts';

const MAIN = 0x0800_0200;
const COPY = 0x0800_0240;
const VENEER = 0x0800_0260;
const BLOCK = 0x0800_0300;
const IWRAM = 0x0300_0100;

interface Options {
  /** The destination main passes in r1. */
  readonly dest?: number;
  /** The IWRAM pointer the veneer loads. */
  readonly pointer?: number;
  /** What the veneer does with it (default `bx r3`). */
  readonly use?: 'bx' | 'store';
  /** The bytes size main passes in r2. */
  readonly size?: number;
}

/** main copies BLOCK (three ARM routines A, B, C at +0, +8, +0x14) to `dest`; the veneer jumps through `pointer`. */
function romFor(o: Options = {}): Rom {
  return romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, o.dest ?? IWRAM, o.size ?? 0x20) },
    { at: COPY, bytes: thumbAt(COPY)`bx lr` },
    { at: VENEER, bytes: o.use === 'store' ? thumbAt(VENEER)`ldr r3, _08000268; str r3, [r0]; bx lr` : thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(o.pointer ?? IWRAM + 8) },
    // BLOCK: A = mov; bx lr. B = add; add; bx lr. C = mov; bx lr.
    { at: BLOCK, bytes: armAt(BLOCK)`mov r0, #0; bx lr; add r0, r0, #1; add r0, r0, #2; bx lr; mov r0, #3; bx lr` },
  ]);
}

/** A view in which `accepted` are functions with their own readings. */
function viewOf(rom: Rom, accepted: readonly number[]): AnalysisView {
  const plain = viewWith({ rom });
  const readings: Reading[] = accepted.map((e) => plain.read(e, 'thumb'));
  return viewWith({ rom, functions: [...accepted], readings });
}

const queue = (rom: Rom, entry: number, accepted: readonly number[]) => {
  const v = viewOf(rom, accepted);
  return rule.queue(factOf(v.read(entry, 'thumb')), v);
};

test('the copy and the jump name the ARM entry at its load address, whichever is accepted later', () => {
  const rom = romFor();
  const expected = [{ entry: BLOCK + 8, mode: 'arm', cites: [VENEER, MAIN] }];
  assert.deepEqual(queue(rom, VENEER, [MAIN, VENEER]), expected, 'the veneer after main');
  assert.deepEqual(queue(rom, MAIN, [VENEER, MAIN]), expected, 'main after the veneer');
  assert.deepEqual(queue(rom, MAIN, [MAIN]), [], 'no jump yet');
  assert.deepEqual(queue(rom, VENEER, [VENEER]), [], 'no copy yet');
  assert.equal(rule.meta.origin, 'ram-copy');
});

test('a Thumb pointer names a Thumb entry; a pointer outside the copy names none', () => {
  const thumbBlock = romWith([
    { at: MAIN, bytes: thumbAt(MAIN)`push {lr}; ldr r0, _08000210; ldr r1, _08000214; ldr r2, _08000218; bl _08000240; pop {pc}` },
    { at: MAIN + 0x10, bytes: words(BLOCK, IWRAM, 0x20) },
    { at: COPY, bytes: thumbAt(COPY)`bx lr` },
    { at: VENEER, bytes: thumbAt(VENEER)`ldr r3, _08000268; bx r3` },
    { at: VENEER + 8, bytes: words(IWRAM + 4 + 1) },
    { at: BLOCK, bytes: thumbAt(BLOCK)`movs r0, #0; bx lr; movs r0, #1; bx lr` },
  ]);
  assert.deepEqual(queue(thumbBlock, VENEER, [MAIN, VENEER]), [{ entry: BLOCK + 4, mode: 'thumb', cites: [VENEER, MAIN] }]);
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x40 }), VENEER, [MAIN, VENEER]), [], 'past the copied bytes');
});

test('declined: the block start, a fall-through entry, a store, an EWRAM copy, an oversized copy', () => {
  assert.deepEqual(queue(romFor({ pointer: IWRAM }), VENEER, [MAIN, VENEER]), [], 'a pointer equal to the destination');
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x0c }), VENEER, [MAIN, VENEER]), [], 'the second add of B: the code before it falls into it');
  assert.deepEqual(queue(romFor({ pointer: IWRAM + 0x14 }), VENEER, [MAIN, VENEER]), [{ entry: BLOCK + 0x14, mode: 'arm', cites: [VENEER, MAIN] }], 'C opens after `bx lr`');
  assert.deepEqual(queue(romFor({ use: 'store' }), VENEER, [MAIN, VENEER]), [], 'the pointer is stored, not jumped through');
  assert.deepEqual(queue(romFor({ dest: 0x0200_0100, pointer: 0x0200_0108 }), VENEER, [MAIN, VENEER]), [], 'EWRAM');
  assert.deepEqual(queue(romFor({ size: 0x2_0000 }), VENEER, [MAIN, VENEER]), [], 'more than ramCopy.maxBytes');
});
