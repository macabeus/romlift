// gap.end-anchor: the best valid reading below the gap end that ends at it or is anchored there.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/end-anchor.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { ViewSetup } from '../../../../helpers/analysis.ts';
import { readingOf, romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { DUMMY_PROFILE } from '../../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { gapCursor } from './cursor.ts';

const X = 0x0800_0300;
const END = X + 0x10;
// X: push {lr}; X+4.. three readings without a prologue; every one ends at X+14, 2 bytes before END.
const rom = romWith([{ at: X, bytes: thumbAt(X)`push {lr}; movs r0, #0; movs r0, #1; movs r0, #2; movs r1, #1; movs r2, #2; pop {pc}` }]);
const propose = (setup: Partial<ViewSetup>, opts: { at?: number; end?: number; head?: number } = {}) =>
  rule.propose(
    gapCursor(X - 0x100, END, opts.at ?? X - 0x100, { end: opts.end ?? END, ...(opts.head === undefined ? {} : { head: readingOf(rom, { entry: X - 0x100, end: opts.head }) }) }),
    viewWith({ rom, ...setup }),
  );

test('without prologues the highest valid reading that ends within fillSlack of the end wins', () => {
  assert.deepEqual(propose({}), { entry: X + 8, mode: 'thumb', cites: [X + 8, END] });
});

test('a prologue below the first candidate wins when the scan reaches it', () => {
  assert.equal(propose({ valid: (a) => a !== X + 4 })?.entry, X, 'X+4 is invalid, so the scan goes on down to X');
});

test('with a prologue chosen the scan goes on to the floor without replacing it (the PoC asks valid() down there)', () => {
  const asked: number[] = [];
  const twin = romWith([
    { at: X - 8, bytes: thumbAt(X - 8)`push {lr}; movs r0, #0; movs r0, #0; movs r0, #0` },
    { at: X, bytes: thumbAt(X)`push {lr}; movs r0, #0; movs r0, #1; movs r0, #2; movs r1, #1; movs r2, #2; pop {pc}` },
  ]);
  const found = rule.propose(gapCursor(X - 0x20, END, X - 0x20), viewWith({ rom: twin, valid: (a) => (asked.push(a), a === X || a === X - 8) }));
  assert.equal(found?.entry, X, 'the highest prologue');
  assert.deepEqual(asked.map((a) => a - X), [12, 8, 4, 0, -4, -8], 'valid() is still asked below the chosen prologue (zero words are skipped before it)');
});

test('a reading anchored at its end by a function counts when it does not reach the end', () => {
  const anchored = romWith([
    { at: X, bytes: thumbAt(X)`movs r0, #0; movs r1, #1; bx lr` },
    { at: X + 6, bytes: thumbAt(X + 6)`bx lr` },
  ]);
  const c = gapCursor(X - 0x20, END, X - 0x20);
  assert.equal(rule.propose(c, viewWith({ rom: anchored })), undefined, 'ends 10 bytes short');
  assert.equal(rule.propose(c, viewWith({ rom: anchored, functions: [X + 6] }))?.entry, X);
});

test('declined: functions, claimed bytes, invalid entries, short readings, code past the end', () => {
  assert.equal(propose({ valid: () => false }), undefined);
  assert.equal(propose({ functions: [X, X + 4, X + 8], valid: (a) => a >= X }), undefined, 'every candidate is a function');
  assert.equal(propose({ claims: [{ span: { start: X, end: END }, kind: Claim.dead }] }), undefined);
  assert.equal(propose({}, { end: X + 0x0c }), undefined, 'code past the end');
  assert.equal(propose({ profile: DUMMY_PROFILE, valid: (a) => a === X + 8 }), undefined, 'dummy: 3 instructions < minInsns 4');
});

test('the floor: the cursor, the head end and end - backwardWindow (profile boundary)', () => {
  assert.equal(propose({}, { at: X + 0x0a }), undefined, 'cursor above every candidate');
  assert.equal(propose({}, { head: X + 0x0a }), undefined, 'head end above every candidate');
  assert.equal(propose({ profile: DUMMY_PROFILE, valid: (a) => a === X }, { end: X + 0x0f })?.entry, X, 'dummy: within 64 bytes, 1 byte of slack');
  const far = romWith([{ at: X, bytes: thumbAt(X)`push {lr}; movs r0, #0; movs r0, #1; pop {pc}; bx lr` }]);
  const c = gapCursor(X - 0x100, X + 0x48, X - 0x100);
  assert.equal(rule.propose(c, viewWith({ rom: far, profile: DUMMY_PROFILE, functions: [X + 8] }))?.entry, undefined, 'dummy: X is 72 bytes below the end');
  assert.equal(rule.propose(c, viewWith({ rom: far, functions: [X + 8] }))?.entry, X, 'agbcc: within 4096 bytes');
});

test('a load-and-jump stub that ends exactly at an accepted stub of the same shape is a veneer array element below minInsns (D60 b)', () => {
  const Y = X + 0x20;
  // Data before the array; two `ldr r3, [pc, #k]; bx r3` stubs laid end to end; their pool after them.
  const veneers = romWith([
    { at: X, bytes: new Uint8Array(0x20).fill(0xff) },
    { at: Y, bytes: thumbAt(Y)`ldr r3, _08000328; bx r3; ldr r3, _0800032C; bx r3` },
    { at: Y + 8, bytes: words(0x03000001, 0x03000101) },
  ]);
  const c = gapCursor(X, Y + 4, X);
  assert.deepEqual(rule.propose(c, viewWith({ rom: veneers, functions: [Y + 4], valid: (a) => a === Y })), { entry: Y, mode: 'thumb', cites: [Y, Y + 4] });
  assert.equal(rule.propose(c, viewWith({ rom: veneers, valid: (a) => a === Y })), undefined, 'the next stub is not accepted');
  // The next function is not such a stub: two instructions stay below minInsns.
  const other = romWith([
    { at: Y, bytes: thumbAt(Y)`ldr r3, _08000328; bx r3; movs r0, #0; bx lr` },
    { at: Y + 8, bytes: words(0x03000001) },
  ]);
  assert.equal(rule.propose(c, viewWith({ rom: other, functions: [Y + 4], valid: (a) => a === Y })), undefined);
  // A stub that jumps through another register than it loads is no veneer.
  const mixed = romWith([
    { at: Y, bytes: thumbAt(Y)`ldr r3, _08000328; bx r2; ldr r3, _0800032C; bx r3` },
    { at: Y + 8, bytes: words(0x03000001, 0x03000101) },
  ]);
  assert.equal(rule.propose(c, viewWith({ rom: mixed, functions: [Y + 4], valid: (a) => a === Y })), undefined);
  // The dummy profile's minInsns is 4; the veneer array element does not depend on it.
  assert.equal(rule.propose(c, viewWith({ rom: veneers, profile: DUMMY_PROFILE, functions: [Y + 4], valid: (a) => a === Y }))?.entry, Y);
});

test('a `push {.., lr}` on the halfword between two words opens a hand-written function there, ranked as a prologue (D60 c)', () => {
  const H = X + 0x0e;
  const END2 = X + 0x14;
  // Stray halfwords up to H, then `push {lr}; bl ...; pop {pc}` at 2 mod 4 ending at END2.
  const half = romWith([
    { at: X, bytes: new Uint8Array(0x0e).fill(0xff) },
    { at: H, bytes: thumbAt(H)`push {lr}; movs r0, #0; pop {pc}` },
  ]);
  const c = gapCursor(X, END2, X);
  assert.deepEqual(rule.propose(c, viewWith({ rom: half, valid: (a) => a === H })), { entry: H, mode: 'thumb', cites: [H, END2] });
  // The word-aligned reading at H - 2 that runs into it is not taken instead.
  assert.deepEqual(rule.propose(c, viewWith({ rom: half, valid: (a) => a === H || a === H - 2 }))?.entry, H);
  // A profile whose Thumb functions are word-aligned only looks at words.
  const aligned = { ...AGBCC, alignment: { ...AGBCC.alignment, thumbFunction: 4 } };
  assert.equal(rule.propose(c, viewWith({ rom: half, profile: aligned, valid: (a) => a === H })), undefined);
  // Without `push {.., lr}` the halfword is no candidate.
  const plain = romWith([
    { at: X, bytes: new Uint8Array(0x0e).fill(0xff) },
    { at: H, bytes: thumbAt(H)`movs r1, #1; movs r0, #0; bx lr` },
  ]);
  assert.equal(rule.propose(c, viewWith({ rom: plain, valid: (a) => a === H })), undefined);
});

test('the 2-mod-4 `push` candidate and the word below it go through one ranking: both are judged, the prologue wins (D60 c)', () => {
  const H = X + 0x0e;
  const END2 = X + 0x14;
  const half = romWith([
    { at: X, bytes: new Uint8Array(0x0e).fill(0xff) },
    { at: H, bytes: thumbAt(H)`push {lr}; movs r0, #0; pop {pc}` },
  ]);
  const c = gapCursor(X, END2, X);
  // Both readings are valid and fill the gap; the word one (at H - 2) is no prologue, so the halfword wins.
  // The word under the halfword candidate is judged too (valid() is asked at H - 2): before e764d41 the
  // halfword candidate skipped it. The outcome is the same either way, since the halfword candidate is a
  // prologue and comes first at its word; what the change fixed is that no candidate is skipped unjudged.
  const asked: number[] = [];
  const found = rule.propose(c, viewWith({ rom: half, valid: (a) => (asked.push(a), a === H || a === H - 2) }));
  assert.equal(found?.entry, H);
  assert.ok(asked.includes(H - 2), `valid() asked at ${asked.map((a) => (a - X).toString(16)).join(', ')}`);
});
