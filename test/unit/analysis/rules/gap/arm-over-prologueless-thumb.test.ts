// gap.arm-over-prologueless-thumb: the comparison of the Thumb and ARM readings at one cursor.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import rule from '../../../../../src/core/analysis/rules/gap/arm-over-prologueless-thumb.ts';
import type { Reading } from '../../../../../src/core/analysis/types.ts';
import type { Rom } from '../../../../../src/foundation/rom/rom.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';

const P = 0x0800_0200;
const Q = 0x0800_0240;
const rom = romWith([
  { at: P, bytes: thumbAt(P)`movs r0, #0; movs r1, #0; bx lr` },
  { at: Q, bytes: thumbAt(Q)`push {lr}; movs r0, #0; pop {pc}` },
  { at: Q + 0x22, bytes: thumbAt(Q + 0x22)`push {lr}; movs r0, #0; pop {pc}` },
]);

function reading(r: Rom, entry: number, mode: 'thumb' | 'arm', codeBytes: number, end = entry + codeBytes): Reading {
  const size = mode === 'arm' ? 4 : 2;
  return readingOf(r, { entry, mode, insns: Array.from({ length: codeBytes / size }, (_, i) => ({ addr: entry + size * i, len: size })), end });
}

test('a Thumb reading that opens with push {.., lr} on a word boundary wins', () => {
  assert.equal(rule.prefer(reading(rom, Q, 'thumb', 6), reading(rom, Q, 'arm', 16), viewWith({ rom })), 'thumb');
});

test('without a prologue, ARM at the same entry wins only when its code ends past the Thumb extent', () => {
  const v = viewWith({ rom });
  assert.equal(rule.prefer(reading(rom, P, 'thumb', 6, P + 12), reading(rom, P, 'arm', 12), v), 'thumb', 'ARM code ends at the Thumb end');
  assert.equal(rule.prefer(reading(rom, P, 'thumb', 6), reading(rom, P, 'arm', 8), v), 'arm', 'ARM explains more bytes');
});

test('without a prologue, ARM found ahead of the cursor wins', () => {
  assert.equal(rule.prefer(reading(rom, P, 'thumb', 6, P + 0x20), reading(rom, P + 4, 'arm', 8), viewWith({ rom })), 'arm');
});

test('a push {.., lr} off a word boundary is no prologue', () => {
  const T = Q + 0x22;
  assert.equal(rule.prefer(reading(rom, T, 'thumb', 6), reading(rom, T, 'arm', 8), viewWith({ rom })), 'arm');
});
