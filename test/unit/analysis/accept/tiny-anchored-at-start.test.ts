import assert from 'node:assert/strict';
import { test } from 'node:test';

import tiny from '../../../../src/core/analysis/rules/accept/tiny-anchored-at-start.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { Candidate } from '../../../../src/core/analysis/types.ts';
import type { CompilerProfile } from '../../../../src/core/profile/types.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { romWith, testProfile, viewWith, walkReading } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const E = 0x0800_0200;

/** The veto on the stub `code` at E, anchored at start or not. */
function vetoes(code: string, opts: { anchored?: boolean; proposedBy?: RuleId; profile?: CompilerProfile } = {}): string | undefined {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`${code}` }]);
  const claims = opts.anchored === false ? [] : [{ span: { start: E - 0x10, end: E }, kind: Claim.code }];
  const v = viewWith({ rom, claims, ...(opts.profile === undefined ? {} : { profile: opts.profile }) });
  const c: Candidate = { entry: E, mode: 'thumb', proposedBy: opts.proposedBy ?? 'gap.forward-chain', cites: [E] };
  return tiny.vetoes(c, walkReading(v, E, 'thumb'), v);
}

test('an anchored stub that opens with a move or a return is taken', () => {
  assert.equal(vetoes('movs r0, #0; bx lr'), undefined);
  assert.equal(vetoes('bx lr'), undefined);
  assert.equal(tiny.kind, 'accept-veto');
  assert.equal(tiny.reason, 'unanchored');
});

test('an unanchored stub is vetoed', () => {
  assert.equal(vetoes('movs r0, #0; bx lr', { anchored: false }), 'a stub of 2 instructions, not anchored at start');
});

test('a stub opening with b, bcc or bl is vetoed even when anchored', () => {
  assert.equal(vetoes('b _080001F0'), 'a stub of 1 instructions that opens with a branch');
  assert.match(vetoes('beq _080001F0; bx lr') ?? '', /opens with a branch/);
  assert.match(vetoes('bl _08000300; bx lr') ?? '', /opens with a branch/);
});

test('the boundary at tinyFunctionInsns: three instructions are not a stub under agbcc, and are under a profile of four', () => {
  assert.equal(vetoes('movs r0, #0; movs r1, #0; bx lr', { anchored: false }), undefined);
  assert.notEqual(vetoes('movs r0, #0; movs r1, #0; bx lr', { anchored: false, profile: { ...testProfile(), tinyFunctionInsns: 4 } }), undefined);
});

test('only forward-chain candidates are judged (thumbCandidate); a tiled hole or an ARM gap candidate is not', () => {
  assert.equal(vetoes('bx lr', { anchored: false, proposedBy: 'gap.tiled-hole-inner' }), undefined);
  assert.equal(vetoes('bx lr', { anchored: false, proposedBy: 'gap.arm-scan' }), undefined);
});
