import assert from 'node:assert/strict';
import { test } from 'node:test';

import noClaimedCode from '../../../../../src/core/analysis/rules/valid/no-claimed-code.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { ClaimKind } from '../../../../../src/core/analysis/types.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';

const E = 0x0800_0200;
const insns = [
  { addr: E, len: 2 },
  { addr: E + 2, len: 4 },
  { addr: E + 6, len: 2 },
];

function check(claims: readonly { start: number; end: number; kind: ClaimKind }[]): string | undefined {
  const rom = romWith([]);
  const v = viewWith({ rom, claims: claims.map((c) => ({ span: { start: c.start, end: c.end }, kind: c.kind })) });
  return noClaimedCode.check(readingOf(rom, { entry: E, insns }), v);
}

test('free instruction bytes pass', () => {
  assert.equal(check([]), undefined);
  assert.equal(check([{ start: E + 8, end: E + 12, kind: Claim.code }]), undefined);
});

test('only the first byte of an instruction is checked, as the PoC does', () => {
  assert.equal(check([{ start: E + 3, end: E + 6, kind: Claim.pool }]), undefined);
});

test('the lowest instruction starting on a claimed byte is reported, whatever the claim', () => {
  assert.equal(check([{ start: E + 6, end: E + 8, kind: Claim.code }, { start: E + 2, end: E + 3, kind: Claim.dead }]), 'its code overlaps claimed bytes at 0x08000202');
  assert.equal(noClaimedCode.reason, 'pool-claimed');
  assert.equal(noClaimedCode.intrinsic, true);
});
