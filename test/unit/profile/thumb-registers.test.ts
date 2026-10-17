// thumbRegisterEffect (core/profile/thumb-registers.ts): the registers a Thumb instruction writes and the
// ones its value is followed back to by the table-base search.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { thumbRegisterEffect } from '../../../src/core/profile/thumb-registers.ts';
import { romWith } from '../../helpers/analysis.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { insnAt } from '../analysis/walk/support.ts';

const F = 0x0800_0200;

function effects(text: string): Array<{ writes: number; from: readonly number[] }> {
  const bytes = thumbAt(F)([text] as unknown as TemplateStringsArray);
  const rom = romWith([{ at: F, bytes }]);
  const out: Array<{ writes: number; from: readonly number[] }> = [];
  for (let a = F; a < F + bytes.length; ) {
    const insn = insnAt(rom, a, 'thumb');
    out.push({ ...thumbRegisterEffect(insn) });
    a += insn.size;
  }
  return out;
}

test('moves, adds and word loads are followed to their source registers', () => {
  assert.deepEqual(effects('movs r1, r2; adds r0, r1, r2; adds r3, r4, #1; adds r5, #8; add r8, r1; mov r9, r2; ldr r0, [r1, r2]; ldr r0, [r3, #4]'), [
    { writes: 1 << 1, from: [2] },
    { writes: 1 << 0, from: [1, 2] },
    { writes: 1 << 3, from: [4] },
    { writes: 1 << 5, from: [5] },
    { writes: 1 << 8, from: [8, 1] },
    { writes: 1 << 9, from: [2] },
    { writes: 1 << 0, from: [1, 2] },
    { writes: 1 << 0, from: [3] },
  ]);
});

test('constants, other arithmetic and byte loads write without being followed; stores, compares and branches write nothing', () => {
  assert.deepEqual(effects('movs r1, #3; lsls r0, r0, #2; subs r2, r2, r1; ldrb r0, [r1, r2]; muls r3, r4'), [
    { writes: 1 << 1, from: [] },
    { writes: 1 << 0, from: [] },
    { writes: 1 << 2, from: [] },
    { writes: 1 << 0, from: [] },
    { writes: 1 << 3, from: [] },
  ]);
  assert.deepEqual(effects('str r0, [r1, #4]; cmp r0, #3; tst r0, r1; push {r4, lr}'), [
    { writes: 0, from: [] },
    { writes: 0, from: [] },
    { writes: 0, from: [] },
    { writes: 0, from: [] },
  ]);
});

test('pop, ldmia, stmia, a call and a BIOS call write their registers', () => {
  assert.deepEqual(effects('pop {r4, r5}; pop {r4, pc}; ldmia r1!, {r2, r3}; stmia r0!, {r1}; bl _08000400; swi #6'), [
    { writes: 0b11_0000, from: [] },
    { writes: (1 << 4) | (1 << 15), from: [] },
    { writes: 0b1110, from: [] },
    { writes: 1, from: [] },
    { writes: 0b0101_0000_0000_1111, from: [] },
    { writes: 0b1111, from: [] },
  ]);
});
