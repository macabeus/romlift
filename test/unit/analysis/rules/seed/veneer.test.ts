import assert from 'node:assert/strict';
import { test } from 'node:test';

import veneer from '../../../../../src/core/analysis/rules/seed/veneer.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { factOf } from './fact.ts';

const F = 0x0800_0100;

test('every veneer, ascending, as ARM', () => {
  const rom = romWith([]);
  const f = factOf(readingOf(rom, { entry: F }), { veneers: [0x0800_0208, 0x0800_0108] });
  assert.deepEqual(veneer.queue(f, viewWith({ rom })), [
    { entry: 0x0800_0108, mode: 'arm', cites: [F] },
    { entry: 0x0800_0208, mode: 'arm', cites: [F] },
  ]);
});

test('no bx pc, no veneer', () => {
  const rom = romWith([]);
  assert.deepEqual(veneer.queue(factOf(readingOf(rom, { entry: F })), viewWith({ rom })), []);
  assert.equal(veneer.meta.origin, 'veneer');
});
