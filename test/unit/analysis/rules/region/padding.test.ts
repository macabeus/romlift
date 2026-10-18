// region.padding: free padding bytes that align the claimed item after them, between claimed bytes
// below the code end, become padding claims.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/region/padding.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { ClaimKind } from '../../../../../src/core/analysis/types.ts';
import type { CompilerProfile } from '../../../../../src/core/profile/types.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../../helpers/dummy-profile.ts';
import { fact, ownerOver } from './facts.ts';

const F = 0x0800_0200;
const span = (start: number, end: number, kind: ClaimKind) => ({ span: { start, end }, kind });

function classify(claims: readonly ReturnType<typeof span>[], profile?: CompilerProfile, bytes = new Uint8Array(0x40)) {
  const rom = romWith([{ at: F, bytes }]);
  const last = claims.reduce((e, c) => Math.max(e, c.span.end), F);
  const facts = [fact(F, last, 'call')];
  return rule.classify(viewWith({ rom, claims, functions: [F], owner: ownerOver(facts), ...(profile === undefined ? {} : { profile }) }));
}

test('a zero halfword before a word-aligned function or pool is padding', () => {
  assert.deepEqual(classify([span(F, F + 6, Claim.code), span(F + 8, F + 0x0c, Claim.code), span(F + 0x0e, F + 0x10, Claim.code), span(F + 0x10, F + 0x12, Claim.code), span(F + 0x14, F + 0x18, Claim.pool)]), [
    { span: { start: F + 6, end: F + 8 }, kind: Claim.padding, when: 'free-bytes' },
    { span: { start: F + 0x12, end: F + 0x14 }, kind: Claim.padding, when: 'free-bytes' },
  ]);
});

test('mov r8, r8 halfwords are padding under agbcc', () => {
  const bytes = new Uint8Array(0x40);
  bytes.set(words(0x46c0_0000), 4);
  assert.equal(classify([span(F, F + 6, Claim.code), span(F + 8, F + 0x0c, Claim.pool)], undefined, bytes).length, 1);
});

test('not padding: nonzero bytes, a run as long as the alignment, a run before an unaligned item', () => {
  const nonzero = new Uint8Array(0x40).fill(0xff);
  assert.deepEqual(classify([span(F, F + 6, Claim.code), span(F + 8, F + 0x0c, Claim.code)], undefined, nonzero), []);
  assert.deepEqual(classify([span(F, F + 4, Claim.code), span(F + 8, F + 0x0c, Claim.code)]), [], 'four free bytes before an aligned item');
  assert.deepEqual(classify([span(F, F + 4, Claim.code), span(F + 6, F + 0x0c, Claim.code)]), [], 'two free bytes before a halfword-aligned item');
});

test('not padding: free bytes at or after the code end', () => {
  assert.deepEqual(classify([span(F, F + 6, Claim.code)]), []);
});

test('the alignment is the profile\'s (profile boundary)', () => {
  const twoByteAlign: CompilerProfile = { ...DUMMY_PROFILE, alignment: { ...DUMMY_PROFILE.alignment, cFunction: 2, pool: 2 } };
  assert.deepEqual(classify([span(F, F + 6, Claim.code), span(F + 8, F + 0x0c, Claim.code)], twoByteAlign), [], 'a halfword run is not shorter than a 2-byte alignment');
  assert.deepEqual(classify([span(F, F + 7, Claim.code), span(F + 8, F + 0x0c, Claim.code)], twoByteAlign).length, 1, 'one byte is');
});
