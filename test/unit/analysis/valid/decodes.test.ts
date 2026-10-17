import assert from 'node:assert/strict';
import { test } from 'node:test';

import decodes from '../../../../src/core/analysis/rules/valid/decodes.ts';
import { readingOf, romWith, viewWith, walkReading } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const E = 0x0800_0200;

test('a reading with instructions and no error passes', () => {
  const rom = romWith([{ at: E, bytes: thumbAt(E)`movs r0, #1; bx lr` }]);
  const v = viewWith({ rom });
  assert.equal(decodes.check(walkReading(v, E, 'thumb'), v), undefined);
});

test('no instruction fails', () => {
  const rom = romWith([]);
  assert.equal(decodes.check(readingOf(rom, { entry: E }), viewWith({ rom })), 'decodes to nothing');
});

test('the first decode error is reported', () => {
  const rom = romWith([]);
  const r = readingOf(rom, {
    entry: E,
    insns: [{ addr: E, len: 2 }],
    errors: [
      { reason: 'not-code', at: E + 2 },
      { reason: 'out-of-rom', at: E + 6 },
    ],
  });
  assert.equal(decodes.check(r, viewWith({ rom })), 'decode error not-code at 0x08000202');
  assert.equal(decodes.reason, 'decode-error');
  assert.equal(decodes.intrinsic, true);
});

test('a walk that runs into an undecodable halfword fails', () => {
  const rom = romWith([{ at: E, bytes: Uint8Array.of(0x01, 0x20, 0xfe, 0xde) }]);
  const v = viewWith({ rom });
  assert.match(decodes.check(walkReading(v, E, 'thumb'), v) ?? '', /^decode error not-code at 0x08000202$/);
});
