import assert from 'node:assert/strict';
import { test } from 'node:test';

import call from '../../../../../src/core/analysis/rules/seed/call.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { factOf } from './fact.ts';

const F = 0x0800_0100;

test("every callee, in the reading's calls order (target, then ARM before Thumb, then site), with its mode", () => {
  const rom = romWith([]);
  const r = readingOf(rom, {
    entry: F,
    calls: [
      { site: F + 8, target: 0x0800_0300, mode: 'thumb' },
      { site: F + 4, target: 0x0800_0300, mode: 'arm' },
      { site: F + 12, target: 0x0800_0200, mode: 'thumb' },
      { site: F + 2, target: 0x0800_0300, mode: 'thumb' },
    ],
  });
  const f = factOf(r);
  assert.deepEqual(call.queue(f, viewWith({ rom })), [
    { entry: 0x0800_0200, mode: 'thumb', cites: [F + 12] },
    { entry: 0x0800_0300, mode: 'arm', cites: [F + 4] },
    { entry: 0x0800_0300, mode: 'thumb', cites: [F + 2] },
    { entry: 0x0800_0300, mode: 'thumb', cites: [F + 8] },
  ]);
});

test('a function without calls queues nothing', () => {
  const rom = romWith([]);
  assert.deepEqual(call.queue(factOf(readingOf(rom, { entry: F })), viewWith({ rom })), []);
  assert.equal(call.meta.origin, 'call');
});
