import assert from 'node:assert/strict';
import { test } from 'node:test';

import { insnAligned, insnUnit, spanContains, spanLength } from '../../../src/foundation/rom/span.ts';

test('spanLength counts the bytes of a half-open span', () => {
  assert.equal(spanLength({ start: 0x0800_0000, end: 0x0800_0010 }), 0x10);
  assert.equal(spanLength({ start: 5, end: 5 }), 0);
});

test('spanContains includes start and excludes end', () => {
  const s = { start: 0x100, end: 0x104 };
  assert.equal(spanContains(s, 0xff), false);
  assert.equal(spanContains(s, 0x100), true);
  assert.equal(spanContains(s, 0x103), true);
  assert.equal(spanContains(s, 0x104), false);
  assert.equal(spanContains({ start: 7, end: 7 }, 7), false);
});

test('insnUnit and insnAligned: a Thumb instruction on a halfword, an ARM one on a word (fix round 7, architecture-b2-8)', () => {
  assert.deepEqual([insnUnit('thumb'), insnUnit('arm')], [2, 4]);
  assert.deepEqual([0x0800_0000, 0x0800_0001, 0x0800_0002, 0x0800_0003].map((a) => insnAligned('thumb', a)), [true, false, true, false]);
  assert.deepEqual([0x0800_0000, 0x0800_0001, 0x0800_0002, 0x0800_0004].map((a) => insnAligned('arm', a)), [true, false, false, true]);
});
