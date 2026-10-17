import assert from 'node:assert/strict';
import { test } from 'node:test';

import dense from '../../../../../src/core/analysis/rules/valid/dense.ts';
import type { CompilerProfile } from '../../../../../src/core/profile/types.ts';
import { readingOf, romWith, testProfile, viewWith } from '../../../../helpers/analysis.ts';

const E = 0x0800_0200;

/** An extent of `size` bytes of non-zero filler from E, every halfword covered but `holes` bytes from E + 0x10 (`zeros` of them zero, last first). */
function check(size: number, holes: number, opts: { zeros?: number; profile?: CompilerProfile } = {}): string | undefined {
  const bytes = new Uint8Array(size).fill(0xff);
  bytes.fill(0, 0x10 + holes - (opts.zeros ?? 0), 0x10 + holes);
  const rom = romWith([{ at: E, bytes }], { size: 0x800 });
  const insns = [];
  for (let a = E; a < E + size; a += 2) if (a < E + 0x10 || a >= E + 0x10 + holes) insns.push({ addr: a, len: 2 });
  const v = viewWith({ rom, ...(opts.profile === undefined ? {} : { profile: opts.profile }) });
  return dense.check(readingOf(rom, { entry: E, insns }), v);
}

test('the boundary at extent >> holeShift: 16 hole bytes in 0x100 pass, 18 fail', () => {
  assert.equal(check(0x100, 16), undefined);
  assert.equal(check(0x100, 18), 'not dense: holes inside its extent (18 bytes in 256)');
  assert.equal(dense.reason, 'not-dense');
  assert.equal(dense.intrinsic, true);
});

test('the floor at minHoles: 8 hole bytes in 0x20 pass, 10 fail', () => {
  assert.equal(check(0x20, 8), undefined);
  assert.notEqual(check(0x20, 10), undefined);
});

test('a zero halfword right before a covered byte is padding, not a hole', () => {
  assert.equal(check(0x100, 18, { zeros: 2 }), undefined);
  assert.notEqual(check(0x100, 20, { zeros: 2 }), undefined);
});

test('the profile sets the shift', () => {
  assert.notEqual(check(0x100, 16, { profile: { ...testProfile(), density: { minHoles: 8, holeShift: 5 } } }), undefined);
});
