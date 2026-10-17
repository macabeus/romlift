// claim.far-pools: pool words outside the extent are claimed as pool when their first byte is free
// (claim(): every pool of the function, start-free).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLAIM_RULES } from '../../../../src/core/analysis/rules/claim/index.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import { BASE, readingOf, romWith, viewWith, words } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { driverOver } from '../bl/support.ts';
import { claimsOf, factOf, run, take } from './support.ts';

const F = 0x0800_0200;
const P = 0x0800_0300;
const rule = CLAIM_RULES['claim.far-pools'];

test('only the pools outside [entry, end) are claimed, start-free, in walk order', () => {
  const rom = romWith([]);
  const r = readingOf(rom, {
    entry: F + 0x10,
    insns: [{ addr: F + 0x10, len: 2 }],
    pools: [{ addr: P, value: 1 }, { addr: F + 0x14, value: 2 }, { addr: F, value: 3 }],
    end: F + 0x18,
  });
  assert.deepEqual(rule.claims(factOf(r), r, viewWith({ rom })), [
    { span: { start: P, end: P + 4 }, kind: Claim.pool, when: 'start-free' },
    { span: { start: F, end: F + 4 }, kind: Claim.pool, when: 'start-free' },
  ]);
  const inside = readingOf(rom, { entry: F, insns: [{ addr: F, len: 2 }], pools: [{ addr: F + 4, value: 0 }], end: F + 8 });
  assert.deepEqual(rule.claims(factOf(inside), inside, viewWith({ rom })), [], 'an adjacent pool is claim.adjacent-pools\'');
});

test('through accept: a pool 0xFC bytes away is claimed outside the extent; a taken first byte keeps its claim', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`ldr r0, _08000300; bx lr` }, { at: P, bytes: words(0x1234_5678) }]);
  const s = driverOver(rom);
  take(s, F);
  assert.equal(s.funcs.get(F)?.reading.end, F + 4, 'the far pool is not in the extent');
  assert.deepEqual(claimsOf(s, P - 4, P + 8), [...run(Claim.free, 4), ...run(Claim.pool, 4), ...run(Claim.free, 4)]);
  const taken = driverOver(rom);
  taken.claims[P - BASE] = Claim.code;
  take(taken, F);
  assert.deepEqual(claimsOf(taken, P, P + 4), [Claim.code, Claim.free, Claim.free, Claim.free]);
  const without = driverOver(rom, 'claim.far-pools');
  take(without, F);
  assert.deepEqual(claimsOf(without, P, P + 4), run(Claim.free, 4), 'without the rule the far pool stays free');
});

test('ARM: an unaligned far pool word is claimed from its own address', () => {
  const rom = romWith([{ at: F, bytes: armAt(F)`ldr r0, _08000302; bx lr` }]);
  const s = driverOver(rom);
  take(s, F, 'arm');
  assert.deepEqual(claimsOf(s, P, P + 8), [Claim.free, Claim.free, ...run(Claim.pool, 4), Claim.free, Claim.free]);
});
