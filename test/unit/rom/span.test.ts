import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spanContains, spanLength } from '../../../src/foundation/rom/span.ts';

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
