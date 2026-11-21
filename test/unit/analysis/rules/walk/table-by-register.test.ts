// walk.table-by-register (milestone M3): a Thumb mov/add pc whose register is followed back through moves,
// adds and the table-slot load to a pool load naming a base just ahead is a jump table; each tableJump
// number at its boundary; a hoisted load at any distance in the run; a nearer load into another register
// is not taken; a register written any other way, or clobbered by a call, ends the trail.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Reading } from '../../../../../src/core/analysis/types.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import { romWith, viewWith, walkReading, words } from '../../../../helpers/analysis.ts';
import type { Placed } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { WALK, cursorOf, insnAt, walkRule, without } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.table-by-register';
const RET = thumbAt(0)`bx lr`;

/** `code` at F, its pool word at `pool` naming `base`, the table words at `base`, and `bx lr` at each of `rets`. */
function program(
  code: Uint8Array,
  pool: number,
  base: number,
  table: readonly number[],
  rets: readonly number[],
  size?: number,
  extra: readonly Placed[] = [],
): Rom {
  const parts: Placed[] = [
    { at: F, bytes: code },
    { at: pool, bytes: words(base) },
    { at: base, bytes: words(...table) },
    ...extra,
  ];
  for (const a of rets) parts.push({ at: a, bytes: RET });
  return romWith(parts, size === undefined ? {} : { size });
}

function walk(rom: Rom): Reading {
  return walkReading(viewWith({ rom }), F, 'thumb', WALK);
}

test('a mov pc whose register comes from a pool load naming a table just ahead walks the targets and ends the path', () => {
  const rom = program(
    thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; mov pc, r0`,
    F + 0x0c,
    F + 0x10,
    [F + 0x20, F + 0x24, 0],
    [F + 0x20, F + 0x24],
  );
  const r = walk(rom);
  assert.deepEqual(r.tables, [{ base: F + 0x10, targets: [F + 0x20, F + 0x24], thumbBit: false }]);
  assert.equal(r.returns, 2, 'both cases are walked; the jump itself is no exit');
  assert.deepEqual(r.errors, []);
  const add = program(
    thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; add pc, r0`,
    F + 0x0c,
    F + 0x10,
    [F + 0x20, 0],
    [F + 0x20],
  );
  assert.deepEqual(
    walk(add).tables.map((t) => t.targets),
    [[F + 0x20]],
    'add pc too',
  );
  // Without the rule the jump is a register jump.
  assert.deepEqual(
    walkReading(viewWith({ rom }), F, 'thumb', without(ID)).exits.map((e) => [e.kind, e.rule]),
    [['reg-jump', 'walk.mov-pc-without-table']],
  );
});

test("agbcc's switch: the base reaches the jump through lsls, adds and a word load, past a hoisted load of 60 instructions", () => {
  // ldr r1, =table; (60 unrelated instructions); lsls r0, r0, #2; adds r0, r0, r1; ldr r0, [r0]; mov pc, r0
  const filler = 'movs r2, #1;'.repeat(60);
  const code = thumbAt(F)`ldr r1, _08000300; ${filler} lsls r0, r0, #2; adds r0, r0, r1; ldr r0, [r0]; mov pc, r0`;
  const r = walk(program(code, F + 0x100, F + 0x104, [F + 0x120, F + 0x124, 0], [F + 0x120, F + 0x124]));
  assert.deepEqual(
    r.tables.map((t) => [t.base, t.targets]),
    [[F + 0x104, [F + 0x120, F + 0x124]]],
  );
});

test('a nearer pool load into another register is not the base; the tracked register follows moves through a high register', () => {
  // r2's word is also a word-aligned ROM address just ahead, the one the old nearest-load rule took.
  const decoy = { at: F + 0x10, bytes: words(F + 0x40) };
  const code = thumbAt(F)`ldr r1, _0800020C; mov r8, r1; ldr r2, _08000210; mov r3, r8; ldr r0, [r3, r0]; mov pc, r0`;
  const r = walk(
    program(code, F + 0x0c, F + 0x14, [F + 0x30, 0], [F + 0x30, F + 0x48], undefined, [
      decoy,
      { at: F + 0x40, bytes: words(F + 0x48, 0) },
    ]),
  );
  assert.deepEqual(
    r.tables.map((t) => [t.base, t.targets]),
    [[F + 0x14, [F + 0x30]]],
  );
});

test('a register written with a constant, or clobbered by a call, ends the trail: no table', () => {
  const constant = thumbAt(F)`ldr r1, _08000210; movs r1, #0; ldr r0, [r1, r0]; mov pc, r0`;
  const r = walk(program(constant, F + 0x10, F + 0x14, [F + 0x30, 0], [F + 0x30]));
  assert.deepEqual(r.tables, []);
  assert.deepEqual(
    r.exits.map((e) => [e.kind, e.rule]),
    [['reg-jump', 'walk.mov-pc-without-table']],
  );
  const call = thumbAt(F)`ldr r0, _08000210; bl _08000280; mov pc, r0`;
  assert.deepEqual(
    walk(program(call, F + 0x10, F + 0x14, [F + 0x30, 0], [F + 0x30, F + 0x80])).tables,
    [],
    'r0 is the callee result',
  );
  // The same load with nothing in between is a table.
  const direct = thumbAt(F)`ldr r0, _08000210; mov pc, r0`;
  assert.deepEqual(
    walk(program(direct, F + 0x10, F + 0x14, [F + 0x30, 0], [F + 0x30])).tables.map((t) => t.base),
    [F + 0x14],
  );
});

test('maxBaseDistance (0x400): a base 0x3FE ahead of the jump is a table, 0x400 ahead is not, nor one behind or unaligned', () => {
  const near = program(
    thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; movs r2, #0; mov pc, r0`,
    F + 0x10,
    F + 0x404,
    [F + 0x20, 0],
    [F + 0x20],
  );
  assert.deepEqual(
    walk(near).tables.map((t) => t.base - (F + 6)),
    [0x3fe],
  );
  const far = program(
    thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`,
    F + 0x10,
    F + 0x404,
    [F + 0x20, 0],
    [F + 0x20],
  );
  const r = walk(far);
  assert.deepEqual(r.tables, []);
  assert.deepEqual(
    r.exits.map((e) => [e.kind, e.rule]),
    [['reg-jump', 'walk.mov-pc-without-table']],
  );
  const before = program(
    thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`,
    F + 0x10,
    F,
    [F + 0x20, 0],
    [F + 0x20],
  );
  assert.deepEqual(walk(before).tables, []);
  const unaligned = program(
    thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`,
    F + 0x10,
    F + 0x16,
    [F + 0x20, 0],
    [F + 0x20],
  );
  assert.deepEqual(walk(unaligned).tables, [], 'a base must be word-aligned');
});

test('maxEntries (2048): the table is cut at 2048 targets', () => {
  const many = (n: number): Rom =>
    program(
      thumbAt(F)`ldr r1, _08000208; mov pc, r1`,
      F + 8,
      F + 0x40,
      [...Array.from({ length: n }, () => F + 0x20), 0],
      [F + 0x20],
    );
  assert.equal(walk(many(2047)).tables[0]?.targets.length, 2047);
  assert.equal(walk(many(2049)).tables[0]?.targets.length, 2048);
});

test('maxTargetSpan (0x10000): a target 0x10000 from the jump is taken, 0x10002 ends the table', () => {
  const span = (d: number): Rom =>
    program(
      thumbAt(F)`ldr r1, _08000208; mov pc, r1`,
      F + 8,
      F + 0x40,
      [F + 0x20, F + 2 + d, 0],
      [F + 0x20, F + 2 + d],
      0x10400,
    );
  assert.deepEqual(walk(span(0x10000)).tables[0]?.targets, [F + 0x20, F + 0x10002]);
  assert.deepEqual(walk(span(0x10002)).tables[0]?.targets, [F + 0x20]);
});

test('the table ends at the lowest target above its base, at an odd target, and at one outside the ROM', () => {
  const tail = (table: readonly number[]): readonly number[] | undefined =>
    walk(program(thumbAt(F)`ldr r1, _08000208; mov pc, r1`, F + 8, F + 0x40, table, [F + 0x20, F + 0x48])).tables[0]
      ?.targets;
  assert.deepEqual(tail([F + 0x48, F + 0x20, F + 0x20]), [F + 0x48, F + 0x20], 'the third slot is the first case');
  assert.deepEqual(tail([F + 0x20, F + 0x21]), [F + 0x20]);
  assert.deepEqual(tail([F + 0x20, 0x0300_0000]), [F + 0x20]);
  assert.equal(tail([F + 0x21]), undefined, 'no target: no table');
});

test('declines: ARM, bx rN, a jump with no pool load before it, and the stop phase', () => {
  const rule = walkRule(ID);
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`bx r0; mov pc, r0` },
    { at: F + 0x10, bytes: armAt(F + 0x10)`mov pc, r0` },
  ]);
  const v = viewWith({ rom });
  const bx = insnAt(rom, F, 'thumb');
  assert.equal(rule.onInsn(bx, cursorOf(v, { entry: F, mode: 'thumb', run: [bx] })), undefined);
  const mov = insnAt(rom, F + 2, 'thumb');
  assert.equal(rule.onInsn(mov, cursorOf(v, { entry: F + 2, mode: 'thumb', run: [mov] })), undefined);
  assert.equal(rule.onInsn(mov, cursorOf(v, { entry: F + 2, mode: 'thumb', run: [mov], phase: 'stop' })), undefined);
  const armMov = insnAt(rom, F + 0x10, 'arm');
  assert.equal(rule.onInsn(armMov, cursorOf(v, { entry: F + 0x10, mode: 'arm', run: [armMov] })), undefined);
});
