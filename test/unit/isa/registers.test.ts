// registerEffect (foundation/isa/registers.ts): the registers a Thumb instruction writes and the ones its
// value is followed back to, read from the row's RegisterSpec (agbcc's table-base search reads it).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerEffect } from '../../../src/foundation/isa/registers.ts';
import { THUMB_BL, THUMB_ROWS } from '../../../src/foundation/isa/thumb-table.ts';
import { romWith } from '../../helpers/analysis.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { insnAt } from '../analysis/rules/walk/support.ts';

const F = 0x0800_0200;

function effects(text: string): Array<{ writes: number; from: readonly number[] }> {
  const bytes = thumbAt(F)([text] as unknown as TemplateStringsArray);
  const rom = romWith([{ at: F, bytes }]);
  const out: Array<{ writes: number; from: readonly number[] }> = [];
  for (let a = F; a < F + bytes.length; ) {
    const insn = insnAt(rom, a, 'thumb');
    out.push({ ...registerEffect(insn) });
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

test('every Thumb row that writes a general register as data says so in the table: no row writes rd without a RegisterSpec', () => {
  const declared = [...THUMB_ROWS, THUMB_BL].filter((r) => r.spec.registers !== undefined).map((r) => r.spec.id);
  const writesRd = [...THUMB_ROWS, THUMB_BL].filter((r) => r.spec.fields.some((f) => f.name === 'rd') && !/^thumb\.(str|strb|strh)_/.test(r.spec.id) && r.spec.id !== 'thumb.str_sp');
  for (const r of writesRd) assert.ok(declared.includes(r.spec.id), `${r.spec.id} has an rd field but no RegisterSpec`);
  assert.equal(declared.length, 44, "the 38 rows that write rd, pop, pop {.., pc}, ldmia, stmia, bl and swi");
});
