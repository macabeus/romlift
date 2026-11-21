// gap.tiled-hole: the head reading of a gap is kept when it fails at most density or stack balance, has
// gapScan.minInsns instructions and keeps its code inside the gap.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/tiled-hole.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { ValidityFailure } from '../../../../../src/core/analysis/types.ts';
import type { MissReason } from '../../../../../src/core/provenance/vocabulary.ts';
import { romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const P = 0x0800_0200;
const END = 0x0800_0240;
const rom = romWith([
  { at: P, bytes: thumbAt(P)`movs r0, #0; movs r1, #1; bx lr` },
  { at: P + 0x10, bytes: thumbAt(P + 0x10)`movs r0, #0; bx lr` },
  { at: P + 0x20, bytes: words(0) },
]);

function failing(reason: MissReason): ValidityFailure {
  return { rule: 'valid.example', reason, intrinsic: true, detail: 'by construction' };
}

test('a head that is valid, not dense or pops the frame is the gap head', () => {
  for (const why of [undefined, failing('not-dense'), failing('pops-frame')]) {
    const r = rule.head(gapCursor(P, END, P), viewWith({ rom, whyInvalid: () => why }));
    assert.equal(r?.entry, P, String(why?.reason));
    assert.equal(r?.codeEnd, P + 6);
  }
});

test('declined: any other validity failure', () => {
  for (const reason of ['decode-error', 'calls-non-code', 'no-return-no-prologue', 'pool-claimed'] as const) {
    assert.equal(
      rule.head(gapCursor(P, END, P), viewWith({ rom, whyInvalid: () => failing(reason) })),
      undefined,
      reason,
    );
  }
});

test('declined: a function, a claimed byte or a zero word at the cursor', () => {
  assert.equal(rule.head(gapCursor(P, END, P), viewWith({ rom, functions: [P] })), undefined);
  assert.equal(
    rule.head(gapCursor(P, END, P), viewWith({ rom, claims: [{ span: { start: P, end: P + 2 }, kind: Claim.dead }] })),
    undefined,
  );
  assert.equal(rule.head(gapCursor(P, END, P + 0x20), viewWith({ rom })), undefined);
});

test('declined: code past the current end', () => {
  assert.equal(rule.head(gapCursor(P, END, P, { end: P + 4 }), viewWith({ rom })), undefined);
  assert.equal(
    rule.head(gapCursor(P, END, P, { end: P + 6 }), viewWith({ rom }))?.entry,
    P,
    'ending exactly at the end',
  );
});

test('at least gapScan.minInsns instructions (profile boundary)', () => {
  assert.equal(rule.head(gapCursor(P, END, P + 0x10), viewWith({ rom })), undefined, 'agbcc: 2 < 3');
  assert.equal(rule.head(gapCursor(P, END, P), viewWith({ rom }))?.entry, P, 'agbcc: 3 instructions');
  assert.equal(rule.head(gapCursor(P, END, P), viewWith({ rom, profile: DUMMY_PROFILE })), undefined, 'dummy: 3 < 4');
});
