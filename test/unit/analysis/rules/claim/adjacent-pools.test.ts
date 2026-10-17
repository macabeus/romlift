// claim.adjacent-pools: the PoC's Func.end (code end extended by pools and tables starting within
// extentPoolGap bytes) and claim()'s pool (start-free) and table (always) writes inside it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLAIM_RULES } from '../../../../../src/core/analysis/rules/claim/index.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { ReadingShape } from '../../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { BASE, readingOf, romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { driverOver } from '../bl/support.ts';
import { claimsOf, factOf, run, take } from './support.ts';

const F = 0x0800_0200;
const C = F + 0x10;
const rule = CLAIM_RULES['claim.adjacent-pools'];

function extentEnd(shape: Partial<ReadingShape>, gap = AGBCC.extentPoolGap): number {
  const end = rule.extentEnd?.({ entry: F, codeEnd: C, pools: [], tables: [], ...shape }, { ...AGBCC, extentPoolGap: gap });
  assert.notEqual(end, undefined);
  return end ?? 0;
}

test('extentPoolGap (8): a pool starting 8 bytes past the code end joins the extent, 9 bytes past does not', () => {
  assert.equal(AGBCC.extentPoolGap, 8);
  assert.equal(extentEnd({}), C);
  assert.equal(extentEnd({ pools: [C + 8] }), C + 12);
  assert.equal(extentEnd({ pools: [C + 9] }), C);
  assert.equal(extentEnd({ pools: [C + 8] }, 4), C, 'the gap is the profile\'s');
});

test('the extent grows through a chain of pools and tables in any walk order, and ignores what lies below', () => {
  assert.equal(extentEnd({ pools: [C + 16, C + 4] }), C + 20, 'C + 4 brings C + 16 within reach');
  assert.equal(extentEnd({ pools: [C + 20, C + 4] }), C + 8, 'C + 20 is 12 bytes past the new end');
  assert.equal(extentEnd({ tables: [{ base: C + 4, targets: [F, F, F], thumbBit: false }], pools: [C + 24] }), C + 28);
  assert.equal(extentEnd({ pools: [F - 8, C - 4] }), C, 'pools below the code end extend nothing');
});

test('claims: pools inside the extent start-free, every table always; a far pool is not this rule\'s', () => {
  const rom = romWith([]);
  const r = readingOf(rom, {
    entry: F,
    insns: [{ addr: F, len: 2 }],
    pools: [{ addr: F + 4, value: 0 }, { addr: F + 0x100, value: 0 }],
    tables: [{ base: F + 0x200, targets: [F, F], thumbBit: false }],
    end: F + 8,
  });
  const edits = rule.claims(factOf(r), r, viewWith({ rom }));
  assert.deepEqual(edits, [
    { span: { start: F + 4, end: F + 8 }, kind: Claim.pool, when: 'start-free' },
    { span: { start: F + 0x200, end: F + 0x208 }, kind: Claim.table, when: 'always' },
  ]);
});

test('through accept: the adjacent pool is claimed as pool and the padding before it is in the extent', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`ldr r0, _08000208; bx lr` }, { at: F + 8, bytes: words(0x1234_5678) }]);
  const s = driverOver(rom);
  take(s, F);
  assert.equal(s.funcs.get(F)?.reading.end, F + 12);
  assert.deepEqual(claimsOf(s, F, F + 12), [...run(Claim.code, 4), ...run(Claim.dead, 4), ...run(Claim.pool, 4)]);
  const taken = driverOver(rom);
  taken.claims[F + 8 - BASE] = Claim.code;
  take(taken, F);
  assert.deepEqual(claimsOf(taken, F + 8, F + 12), [Claim.code, Claim.dead, Claim.dead, Claim.dead], 'a pool whose first byte is taken is not claimed');
});

test('through accept: a jump table overwrites what was claimed before', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`ldr r1, _0800020C; ldr r0, [r1, r0]; mov pc, r0` },
    { at: F + 0x0c, bytes: words(F + 0x10, F + 0x20, F + 0x22, 0) },
    { at: F + 0x20, bytes: thumbAt(F + 0x20)`bx lr; bx lr` },
  ]);
  const s = driverOver(rom);
  s.claims.fill(Claim.code, F + 0x10 - BASE, F + 0x18 - BASE);
  take(s, F);
  assert.deepEqual(claimsOf(s, F + 0x0c, F + 0x18), [...run(Claim.pool, 4), ...run(Claim.table, 8)]);
});
