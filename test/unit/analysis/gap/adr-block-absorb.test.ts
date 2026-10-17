// gap.adr-block-absorb: a block named by the previous Thumb function's adr and leaving only by tail
// branches back into it is merged; every other shape is declined.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../src/core/analysis/rules/gap/adr-block-absorb.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisView } from '../../../../src/core/analysis/types.ts';
import type { CompilerProfile } from '../../../../src/core/profile/types.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { romWith, viewWith, walkReading } from '../../../helpers/analysis.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const G = 0x0800_0200; // adr r0, H; movs r1, #0; bx lr  (code ends at G + 6)
const H = 0x0800_0208; // the handler block
const END = 0x0800_0240;

/** A view in which G is accepted, its code claimed, and H named by G's adr. */
function setup(block: Uint8Array, opts: { readonly profile?: CompilerProfile; readonly owner?: boolean; readonly extra?: { at: number; bytes: Uint8Array }[] } = {}): { rom: Rom; v: AnalysisView } {
  const rom = romWith([{ at: G, bytes: thumbAt(G)`adr r0, _08000208; back: movs r1, #0; bx lr` }, { at: H, bytes: block }, ...(opts.extra ?? [])]);
  const base = { rom, claims: [{ span: { start: G, end: G + 6 }, kind: Claim.code }], functions: [G], ...(opts.profile === undefined ? {} : { profile: opts.profile }) };
  const g = walkReading(viewWith(base), G, 'thumb');
  const v = viewWith({ ...base, readings: [g] });
  return { rom, v: { ...v, adrOwner: (a) => (opts.owner !== false && g.adrs.includes(a) ? G : undefined) } };
}

test('a block that leaves only by branching back into the function naming it is merged into it', () => {
  const { v } = setup(thumbAt(H)`movs r2, #1; b _08000202`);
  assert.deepEqual(rule.absorb(gapCursor(G + 6, END, H), v), { into: G, span: { start: H, end: H + 4 } });
});

test('declined: no adr names the block', () => {
  const { v } = setup(thumbAt(H)`movs r2, #1; b _08000202`, { owner: false });
  assert.equal(rule.absorb(gapCursor(G + 6, END, H), v), undefined);
});

test('declined: the block returns by itself, or branches into another function', () => {
  assert.equal(rule.absorb(gapCursor(G + 6, END, H), setup(thumbAt(H)`movs r2, #1; bx lr`).v), undefined, 'a return of its own');
  const other = 0x0800_0230;
  const { v } = setup(thumbAt(H)`movs r2, #1; b _08000230`, { extra: [{ at: other, bytes: thumbAt(other)`bx lr` }] });
  const claimed: AnalysisView = { ...v, claimAt: (a) => (a >= other && a < other + 2 ? Claim.code : v.claimAt(a)) };
  assert.equal(rule.absorb(gapCursor(G + 6, END, H), claimed), undefined, 'a tail into code that is not the owner');
});

test('declined: the block opens with a prologue, decodes past the end, or the cursor is zero or claimed', () => {
  assert.equal(rule.absorb(gapCursor(G + 6, END, H), setup(thumbAt(H)`push {lr}; b _08000202`).v), undefined, 'a prologue');
  const { v } = setup(thumbAt(H)`movs r2, #1; b _08000202`);
  assert.equal(rule.absorb(gapCursor(G + 6, H + 2, H, { end: H + 2 }), v), undefined, 'its code ends past the gap end');
  assert.equal(rule.absorb(gapCursor(G + 6, END, G + 6), v), undefined, 'a zero halfword (the driver retries 2 bytes on)');
  assert.equal(rule.absorb(gapCursor(G + 6, END, H), { ...v, claimAt: (a) => (a === H ? Claim.pool : v.claimAt(a)) }), undefined, 'claimed');
});

test('the owner must end within anchorSlack of the gap start and start before it (profile boundary)', () => {
  const block = thumbAt(H)`movs r2, #1; b _08000202`;
  const agbcc = setup(block).v;
  assert.notEqual(rule.absorb(gapCursor(G + 6 + 3, END, H), agbcc), undefined, 'agbcc: 3 bytes of slack');
  assert.equal(rule.absorb(gapCursor(G + 6 + 4, END, H), agbcc), undefined, 'agbcc: 4 bytes is too far');
  const dummy = setup(block, { profile: DUMMY_PROFILE }).v;
  assert.notEqual(rule.absorb(gapCursor(G + 6 + 1, END, H), dummy), undefined, 'dummy: 1 byte of slack');
  assert.equal(rule.absorb(gapCursor(G + 6 + 2, END, H), dummy), undefined, 'dummy: 2 bytes is too far');
  assert.equal(rule.absorb(gapCursor(G, END, H), agbcc), undefined, 'the owner starts at the gap start');
});
