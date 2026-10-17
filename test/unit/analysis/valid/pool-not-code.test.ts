import assert from 'node:assert/strict';
import { test } from 'node:test';

import poolNotCode from '../../../../src/core/analysis/rules/valid/pool-not-code.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { ClaimKind } from '../../../../src/core/analysis/types.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';

const E = 0x0800_0200;
const P1 = 0x0800_0240;
const P2 = 0x0800_0220;

function check(claims: readonly { at: number; kind: ClaimKind }[]): string | undefined {
  const rom = romWith([]);
  const v = viewWith({ rom, claims: claims.map((c) => ({ span: { start: c.at, end: c.at + 4 }, kind: c.kind })) });
  const r = readingOf(rom, { entry: E, insns: [{ addr: E, len: 2 }], pools: [{ addr: P1, value: 1 }, { addr: P2, value: 2 }] });
  return poolNotCode.check(r, v);
}

test('a pool word shared with another function (claimed as pool) or free passes', () => {
  assert.equal(check([]), undefined);
  assert.equal(check([{ at: P1, kind: Claim.pool }, { at: P2, kind: Claim.table }]), undefined);
});

test('a pool word claimed as code fails; pools are checked in walk order', () => {
  assert.equal(check([{ at: P1, kind: Claim.code }, { at: P2, kind: Claim.code }]), 'its pool at 0x08000240 is claimed code');
  assert.equal(check([{ at: P2, kind: Claim.code }]), 'its pool at 0x08000220 is claimed code');
  assert.equal(poolNotCode.reason, 'pool-claimed');
  assert.equal(poolNotCode.intrinsic, true);
});
