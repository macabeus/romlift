// The validity of a listed extent (phase-6.md Q10, option (c), D100): a listed Thumb entry that asks for validation is
// judged with the ARM code of its extent's inner label (an [entry_points] entry) of mode arm checked as ARM, and a fall-through into the
// next listed function is its exit; anything else still warns W_LISTED_INVALID. Run with the agbcc profile, as a
// confirm run after `init` runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze } from '../../../../src/core/analysis/driver/run.ts';
import { otherModeLabels } from '../../../../src/core/analysis/driver/listed-extent.ts';
import type { OverrideFact, Seed } from '../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { romWith } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const F = 0x0800_0200;
const G = 0x0800_0240;

const seed = (entry: number, extra: Partial<Seed> = {}): Seed => ({ entry, mode: 'thumb', rule: 'seed.listed', ...extra });

/** The W_LISTED_INVALID diagnostics of a confirm run over `seeds`, as [addr, message]. */
function listedInvalid(rom: Rom, seeds: readonly Seed[], overrides: readonly OverrideFact[] = []): readonly (readonly [number | undefined, string])[] {
  const result = analyze(rom, AGBCC, { mode: 'confirm', seeds, overrides, trail: 'off' });
  return result.diagnostics.filter((d) => d.code === 'W_LISTED_INVALID').map((d) => [d.addr, d.message] as const);
}

// umul3232H32's shape: a Thumb entry that switches to ARM in place, its ARM body right after the bx.
const umul = (body: Uint8Array): Rom =>
  romWith([
    { at: F, bytes: thumbAt(F)`adr r2, _08000204; bx r2` },
    { at: F + 4, bytes: body },
    { at: G, bytes: thumbAt(G)`bx lr` },
  ]);
const BODY = armAt(F + 4)`umull r2, r3, r0, r1; add r0, r3, #0; bx lr`;

test('an ARM inner label is checked as ARM: its ARM code is no hole of the Thumb entry', () => {
  const rom = umul(BODY);
  const arm = seed(F + 4, { mode: 'arm', label: true });
  assert.deepEqual(listedInvalid(rom, [seed(F, { validate: true }), arm, seed(G)]), []);
  // The same entry with a listed size covering the body, as the ELF types it (16 bytes): still valid.
  assert.deepEqual(listedInvalid(rom, [seed(F, { validate: true, size: 16 }), arm, seed(G)]), []);
  // Without the label the ARM body is twelve bytes of holes in sixteen, as before Q10.
  assert.deepEqual(listedInvalid(rom, [seed(F, { validate: true }), seed(G)]), [[F, 'the listed function 0x08000200 fails valid.dense: not dense: holes inside its extent (12 bytes in 16)']]);
});

test('an ARM inner label whose ARM code the valid.* rules refuse still warns, naming the label', () => {
  // An ARM body that runs into undefined words, inside the 16 bytes the entry's listed size gives its extent (the Thumb
  // walk records no ARM tail that does not decode to a return, so without a size the extent would end at the bx).
  const rom = umul(Uint8Array.from([0x00, 0x00, 0xa0, 0xe1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  const warned = listedInvalid(rom, [seed(F, { validate: true, size: 16 }), seed(F + 4, { mode: 'arm', label: true }), seed(G)]);
  assert.equal(warned.length, 1);
  assert.equal(warned[0]?.[0], F);
  assert.match(warned[0]?.[1] ?? '', /fails valid\.[a-z-]+: its arm label 0x08000204: /);
});

test('the labels checked as their own mode: the inner labels of the extent whose mode is not the entry\'s', () => {
  const listed = new Map<number, Seed>([
    [F, seed(F)],
    [F + 4, seed(F + 4, { mode: 'arm', label: true })],
    [F + 8, seed(F + 8, { mode: 'arm', label: true })],
    [F + 0x20, seed(F + 0x20, { label: true })],
    [F + 0x28, seed(F + 0x28, { mode: 'arm' })],
    [G, seed(G, { mode: 'arm', label: true })],
  ]);
  const s = { listed, listedOrder: [...listed.keys()] };
  const entries = (end: number): readonly number[] => otherModeLabels(s, F, 'thumb', end).map((l) => l.entry);
  assert.deepEqual(entries(G), [F + 4, F + 8], 'a Thumb label, an ARM function and a label at the end are not');
  assert.deepEqual(entries(F + 8), [F + 4]);
  assert.deepEqual(otherModeLabels(s, F + 4, 'arm', G).map((l) => l.entry), [F + 0x20]);
});

// ldrb_r3_r2's shape: two bytes that fall through into chk_adr_r2, the next listed function.
const H = F + 2;

test('a fall-through into the next listed function, starting exactly at the end, is the exit', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`ldrb r3, [r2]; cmp r3, #0; bx lr` }]);
  assert.deepEqual(listedInvalid(rom, [seed(F, { validate: true }), seed(H, { validate: true })]), []);
  assert.deepEqual(listedInvalid(rom, [seed(F, { validate: true, size: 2 }), seed(H)]), [], 'a listed size ending at the next function');
});

test('anything that is not a real fall-through still warns', () => {
  const noReturn = (at: number): readonly (readonly [number | undefined, string])[] => [[at, `the listed function 0x${at.toString(16).toUpperCase().padStart(8, '0')} fails valid.returns-or-prologue: no return and no push {.., lr}`]];
  // The extent ends two bytes before the next listed function (a data override there, which no walk enters).
  const gap = romWith([{ at: F, bytes: thumbAt(F)`ldrb r3, [r2]` }, { at: F + 4, bytes: thumbAt(F + 4)`bx lr` }]);
  const data: OverrideFact = { span: { start: H, end: F + 4 }, kind: 'data' };
  assert.deepEqual(listedInvalid(gap, [seed(F, { validate: true }), seed(F + 4)], [data]), noReturn(F));
  // Without the override the next listed function starts at the end, and the same two bytes fall through into it.
  assert.deepEqual(listedInvalid(gap, [seed(F, { validate: true }), seed(H)]), []);
  // The last instruction ends at the next function but branches back: no path reaches it.
  const loop = romWith([{ at: F, bytes: thumbAt(F)`ldrb r3, [r2]; b _08000200; bx lr` }]);
  assert.deepEqual(listedInvalid(loop, [seed(F, { validate: true }), seed(F + 4)]), noReturn(F));
});
