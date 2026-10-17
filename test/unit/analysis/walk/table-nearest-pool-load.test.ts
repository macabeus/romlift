// walk.table-nearest-pool-load: Thumb mov/add pc after a pool load naming a base just ahead is a jump
// table (analyzeThumb `mov_pc`), with each tableJump number at its boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { Reading } from '../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { romWith, viewWith, walkReading, words } from '../../../helpers/analysis.ts';
import type { Placed } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { cursorOf, insnAt, WALK, walkRule } from './support.ts';

const F = 0x0800_0200;
const ID = 'walk.table-nearest-pool-load';
const RET = thumbAt(0)`bx lr`;

/** `code` at F, its pool word at `pool` naming `base`, the table words at `base`, and `bx lr` at each of `rets`. */
function program(code: Uint8Array, pool: number, base: number, table: readonly number[], rets: readonly number[], size?: number): Rom {
  const parts: Placed[] = [{ at: F, bytes: code }, { at: pool, bytes: words(base) }, { at: base, bytes: words(...table) }];
  for (const a of rets) parts.push({ at: a, bytes: RET });
  return romWith(parts, size === undefined ? {} : { size });
}

function walk(rom: Rom): Reading {
  return walkReading(viewWith({ rom }), F, 'thumb', WALK);
}

/** `ldr r1, pool; filler × k; mov pc, r1` with the pool at F + 0x80. */
function behind(k: number): Uint8Array {
  return thumbAt(F)`ldr r1, _08000280; ${'adds r0, #1;'.repeat(k)} mov pc, r1`;
}

test('a mov pc after a pool load naming a table just ahead walks the targets and ends the path', () => {
  const rom = program(thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; mov pc, r0`, F + 0x0c, F + 0x10, [F + 0x20, F + 0x24, 0], [F + 0x20, F + 0x24]);
  const r = walk(rom);
  assert.deepEqual(r.tables, [{ base: F + 0x10, targets: [F + 0x20, F + 0x24], thumbBit: false }]);
  assert.equal(r.returns, 2, 'both cases are walked; the jump itself is no exit');
  assert.deepEqual(r.errors, []);
  const add = program(thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; add pc, r0`, F + 0x0c, F + 0x10, [F + 0x20, 0], [F + 0x20]);
  assert.deepEqual(walk(add).tables.map((t) => t.targets), [[F + 0x20]], 'add pc too');
});

test('maxBaseDistance (0x400): a base 0x3FE ahead of the jump is a table, 0x400 ahead is not, nor one behind', () => {
  const near = program(thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; movs r2, #0; mov pc, r0`, F + 0x10, F + 0x404, [F + 0x20, 0], [F + 0x20]);
  assert.deepEqual(walk(near).tables.map((t) => t.base - (F + 6)), [0x3fe]);
  const far = program(thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`, F + 0x10, F + 0x404, [F + 0x20, 0], [F + 0x20]);
  const r = walk(far);
  assert.deepEqual(r.tables, []);
  assert.deepEqual(r.exits.map((e) => [e.kind, e.rule]), [['reg-jump', 'walk.mov-pc-without-table']]);
  const before = program(thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`, F + 0x10, F, [F + 0x20, 0], [F + 0x20]);
  assert.deepEqual(walk(before).tables, []);
  const unaligned = program(thumbAt(F)`ldr r1, _08000210; ldr r0, [r1, r0]; mov pc, r0`, F + 0x10, F + 0x16, [F + 0x20, 0], [F + 0x20]);
  assert.deepEqual(walk(unaligned).tables, [], 'a base must be word-aligned');
});

test('lookBehindInsns (40): the load may be 39 instructions before the jump, not 40', () => {
  const at = (k: number): Rom => program(behind(k), F + 0x80, F + 0x84, [F + 0x90, 0], [F + 0x90]);
  assert.equal(AGBCC.tableJump.lookBehindInsns, 40);
  assert.deepEqual(walk(at(38)).tables.map((t) => t.targets), [[F + 0x90]]);
  assert.deepEqual(walk(at(39)).tables, []);
});

test('maxEntries (2048): the table is cut at 2048 targets', () => {
  const many = (n: number): Rom => program(thumbAt(F)`ldr r1, _08000208; mov pc, r1`, F + 8, F + 0x40, [...Array.from({ length: n }, () => F + 0x20), 0], [F + 0x20]);
  assert.equal(walk(many(2047)).tables[0]?.targets.length, 2047);
  assert.equal(walk(many(2049)).tables[0]?.targets.length, 2048);
});

test('maxTargetSpan (0x10000): a target 0x10000 from the jump is taken, 0x10002 ends the table', () => {
  const span = (d: number): Rom => program(thumbAt(F)`ldr r1, _08000208; mov pc, r1`, F + 8, F + 0x40, [F + 0x20, F + 2 + d, 0], [F + 0x20, F + 2 + d], 0x10400);
  assert.deepEqual(walk(span(0x10000)).tables[0]?.targets, [F + 0x20, F + 0x10002]);
  assert.deepEqual(walk(span(0x10002)).tables[0]?.targets, [F + 0x20]);
});

test('the table ends at the lowest target above its base, at an odd target, and at one outside the ROM', () => {
  const tail = (table: readonly number[]): readonly number[] | undefined =>
    walk(program(thumbAt(F)`ldr r1, _08000208; mov pc, r1`, F + 8, F + 0x40, table, [F + 0x20, F + 0x48])).tables[0]?.targets;
  assert.deepEqual(tail([F + 0x48, F + 0x20, F + 0x20]), [F + 0x48, F + 0x20], 'the third slot is the first case');
  assert.deepEqual(tail([F + 0x20, F + 0x21]), [F + 0x20]);
  assert.deepEqual(tail([F + 0x20, 0x0300_0000]), [F + 0x20]);
  assert.equal(tail([F + 0x21]), undefined, 'no target: no table');
});

test('declines: ARM, bx rN, a jump with no pool load before it, and the stop phase', () => {
  const rule = walkRule(ID);
  const rom = romWith([{ at: F, bytes: thumbAt(F)`bx r0; mov pc, r0` }, { at: F + 0x10, bytes: armAt(F + 0x10)`mov pc, r0` }]);
  const v = viewWith({ rom });
  const bx = insnAt(rom, F, 'thumb');
  assert.equal(rule.onInsn(bx, cursorOf(v, { entry: F, mode: 'thumb', run: [bx] })), undefined);
  const mov = insnAt(rom, F + 2, 'thumb');
  assert.equal(rule.onInsn(mov, cursorOf(v, { entry: F + 2, mode: 'thumb', run: [mov] })), undefined);
  assert.equal(rule.onInsn(mov, cursorOf(v, { entry: F + 2, mode: 'thumb', run: [mov], phase: 'stop' })), undefined);
  const armMov = insnAt(rom, F + 0x10, 'arm');
  assert.equal(rule.onInsn(armMov, cursorOf(v, { entry: F + 0x10, mode: 'arm', run: [armMov] })), undefined);
});
