import assert from 'node:assert/strict';
import { test } from 'node:test';

import notPointerTable from '../../../../../src/core/analysis/rules/valid/not-pointer-table.ts';
import type { CompilerProfile } from '../../../../../src/core/profile/types.ts';
import { readingOf, romWith, testProfile, viewWith, words } from '../../../../helpers/analysis.ts';

const E = 0x0800_0200;
const P = 0x0800_0401; // a Thumb pointer to a word-aligned ROM address
const N = 0x46c0_46c0; // two nops

/** The verdict over `values` laid out from E, read as halfword instructions from `entry` (minus `skip`). */
function check(values: readonly number[], opts: { entry?: number; skip?: readonly number[]; profile?: CompilerProfile } = {}): string | undefined {
  const rom = romWith([{ at: E, bytes: words(...values) }], { size: 0x800 });
  const entry = opts.entry ?? E;
  const insns = [];
  for (let a = entry; a < E + 4 * values.length; a += 2) if (!(opts.skip ?? []).includes(a & ~3)) insns.push({ addr: a, len: 2 });
  const v = viewWith({ rom, ...(opts.profile === undefined ? {} : { profile: opts.profile }) });
  return notPointerTable.check(readingOf(rom, { entry, insns }), v);
}

const repeat = (value: number, n: number): number[] => Array.from({ length: n }, () => value);

test('four Thumb pointers in four words is a table', () => {
  assert.equal(check(repeat(P, 4)), 'its words are Thumb code pointers: a table, not code (4 of 4)');
  assert.equal(notPointerTable.reason, 'pointer-table');
  assert.equal(notPointerTable.intrinsic, true);
});

test('the boundary on pointers: three are not enough (pointerWords.minPointers 4)', () => {
  assert.equal(check(repeat(P, 3)), undefined);
  assert.notEqual(check(repeat(P, 3), { profile: { ...testProfile(), pointerWords: { minPointers: 3, minShare: 0.25 } } }), undefined);
});

test('the boundary on the share: 4 of 16 words is a table, 4 of 17 is not (pointerWords.minShare 1/4)', () => {
  assert.notEqual(check([...repeat(P, 4), ...repeat(N, 12)]), undefined);
  assert.equal(check([...repeat(P, 4), ...repeat(N, 13)]), undefined);
});

test('a word with no instruction at either halfword is not counted', () => {
  assert.notEqual(check([...repeat(P, 4), ...repeat(N, 13)], { skip: [E + 4 * 10] }), undefined);
});

test('words are counted from the first aligned word at or after the entry', () => {
  assert.equal(check(repeat(P, 4), { entry: E + 2 }), undefined);
});
