// The thumb`` and arm`` byte builders that rule tests use.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arm, armAt } from '../../helpers/arm.ts';
import { thumb, thumbAt } from '../../helpers/thumb.ts';

test('thumb`` assembles lines into little-endian halfwords', () => {
  assert.deepEqual(thumb`push {r4, lr}`, Uint8Array.of(0x10, 0xb5));
  assert.deepEqual(thumb`movs r0, #1; bx lr`, Uint8Array.of(0x01, 0x20, 0x70, 0x47));
  assert.deepEqual(thumb`bl _08000004`, Uint8Array.of(0x00, 0xf0, 0x00, 0xf8));
});

test('labels, comments and interpolated values', () => {
  const reg = 'r3';
  const bytes = thumb`
    loop:            @ count down
      subs ${reg}, #1
      bne loop
      bx lr
  `;
  assert.deepEqual(bytes, Uint8Array.of(0x01, 0x3b, 0xfd, 0xd1, 0x70, 0x47));
  assert.deepEqual(thumbAt(0x0800_0002)`ldr r0, pool; pool:`, Uint8Array.of(0x00, 0x48));
});

test('arm`` assembles words', () => {
  assert.deepEqual(arm`bx lr`, Uint8Array.of(0x1e, 0xff, 0x2f, 0xe1));
  assert.deepEqual(armAt(0x0800_0100)`b _08000100`, Uint8Array.of(0xfe, 0xff, 0xff, 0xea));
});

test('a line that does not assemble throws and names it', () => {
  assert.throws(() => thumb`mov r0, r1`, /cannot assemble 'mov r0, r1'/);
  assert.throws(() => arm`frob`, /cannot assemble 'frob'/);
});
