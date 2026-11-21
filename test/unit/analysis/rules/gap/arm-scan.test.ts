// gap.arm-scan: an unreferenced ARM function at the cursor or past its own front pools, with the
// profile's minimum size, window and skip size.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/arm-scan.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { Placed } from '../../../../helpers/analysis.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { DUMMY_PROFILE } from '../../../../helpers/dummy-profile.ts';
import { assembleSnippet } from '../../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const P = 0x0800_0200;
const END = 0x0800_0300;
const at = (offset: number, text: string): Placed => ({
  at: P + offset,
  bytes: assembleSnippet('arm', text, P + offset),
});
const scan = (
  parts: readonly Placed[],
  opts: { end?: number; dummy?: boolean; claims?: Parameters<typeof viewWith>[0]['claims'] } = {},
) =>
  rule.propose(
    gapCursor(P, END, P, { end: opts.end ?? END }),
    viewWith({
      rom: romWith(parts),
      ...(opts.dummy === true ? { profile: DUMMY_PROFILE } : {}),
      ...(opts.claims === undefined ? {} : { claims: opts.claims }),
    }),
  );

test('an ARM function at the cursor is proposed, with the arm-unreached reason on the rule', () => {
  assert.deepEqual(scan([at(0, 'mov r0, #1; mov r1, #2; bx lr')]), { entry: P, mode: 'arm', cites: [P, P] });
  assert.equal(rule.reason, 'arm-unreached');
  assert.equal(
    scan([at(0, 'bl _08000280; mov r1, #2; bx lr'), at(0x80, 'bx lr')])?.entry,
    P,
    'a bl is not a branch here',
  );
});

test('declined: it opens with a branch, a condition, or an undefined word', () => {
  assert.equal(scan([at(0, 'b _08000208; mov r0, #1; mov r1, #2; bx lr')]), undefined);
  assert.equal(scan([at(0, 'moveq r0, #1; mov r1, #2; bx lr')]), undefined);
  assert.equal(scan([{ at: P, bytes: words(0xffff_ffff) }, at(4, 'mov r1, #2; bx lr')]), undefined);
});

test('at least gapScan.minInsns instructions (profile boundary)', () => {
  const three = [at(0, 'mov r0, #1; mov r1, #2; bx lr')];
  const four = [at(0, 'mov r0, #1; mov r1, #2; mov r2, #3; bx lr')];
  assert.equal(scan([at(0, 'mov r0, #1; bx lr')]), undefined, 'agbcc: 2 < 3');
  assert.equal(scan(three, { dummy: true }), undefined, 'dummy: 3 < 4');
  assert.equal(scan(four, { dummy: true })?.entry, P, 'dummy: 4');
});

test('declined: no return, an error, code past the end, or claimed code', () => {
  assert.equal(
    scan([at(0, 'mov r0, #1; mov r1, #2; mov r2, #3'), { at: P + 12, bytes: words(0xffff_ffff) }]),
    undefined,
  );
  assert.equal(scan([at(0, 'mov r0, #1; mov r1, #2; bx lr')], { end: P + 8 }), undefined);
  assert.equal(scan([at(0, 'mov r0, #1; mov r1, #2; bx lr')], { end: P + 12 })?.entry, P, 'ending exactly at the end');
  assert.equal(
    scan([at(0, 'mov r0, #1; mov r1, #2; bx lr')], {
      claims: [{ span: { start: P + 4, end: P + 8 }, kind: Claim.dead }],
    }),
    undefined,
  );
});

test('a pool claimed as code declines it; a pool claimed as a pool does not', () => {
  const code = [at(0, 'ldr r0, _08000210; mov r1, #2; bx lr'), { at: P + 0x10, bytes: words(0x1234_5678) }];
  assert.equal(scan(code, { claims: [{ span: { start: P + 0x10, end: P + 0x14 }, kind: Claim.code }] }), undefined);
  assert.equal(scan(code, { claims: [{ span: { start: P + 0x10, end: P + 0x14 }, kind: Claim.pool }] })?.entry, P);
});

test('not dense: proposed only when it fills the gap within fillSlack', () => {
  const holey = [
    at(0, 'mov r0, #0; b _08000220'),
    { at: P + 8, bytes: words(0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0xffff_ffff) },
    at(0x20, 'mov r1, #1; bx lr'),
  ];
  assert.equal(scan(holey, { end: P + 0x28 })?.entry, P, 'fills exactly');
  assert.equal(scan(holey, { end: P + 0x2b })?.entry, P, 'agbcc: 3 bytes of slack');
  assert.equal(scan(holey, { end: P + 0x2c }), undefined, 'agbcc: 4 bytes short and not dense');
});

test('a function ahead of pool words it loads is proposed at its entry, up to armFrontPoolWords words ahead (profile boundary)', () => {
  const front = (n: number): Placed[] => [
    { at: P, bytes: words(...Array.from({ length: n }, (_, i) => 0x0800_0000 + 4 * i)) },
    { at: P + 4 * n, bytes: armAt(P + 4 * n)`ldr r0, _08000200; mov r1, #2; mov r2, #3; bx lr` },
  ];
  assert.equal(scan(front(1))?.entry, P + 4);
  assert.equal(scan(front(3))?.entry, P + 12, 'agbcc: 3 ≤ 16 words');
  assert.equal(scan(front(2), { dummy: true })?.entry, P + 8, 'dummy: 2 ≤ 2 words');
  assert.equal(scan(front(3), { dummy: true }), undefined, 'dummy: 3 > 2 words');
});

test('a pool value that refers back into the skipped words counts as a front reference', () => {
  const parts = [
    { at: P, bytes: words(0) },
    at(4, 'ldr r0, _08000220; mov r1, #2; bx lr'),
    { at: P + 0x20, bytes: words(P) },
  ];
  assert.equal(scan(parts)?.entry, P + 4);
});

test('one word ahead with no front reference: only with armMinInsnsForSkip instructions (profile boundary)', () => {
  const parts = [{ at: P, bytes: words(0) }, at(4, 'mov r0, #1; mov r1, #2; mov r2, #3; bx lr')];
  assert.equal(scan(parts), undefined, 'agbcc: 4 < 16');
  assert.equal(scan(parts, { dummy: true })?.entry, P + 4, 'dummy: 4 ≥ 4');
});
