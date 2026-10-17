import assert from 'node:assert/strict';
import { test } from 'node:test';

import adr from '../../../../src/core/analysis/rules/seed/adr.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { factOf } from './fact.ts';

const F = 0x0800_0100;

test('adr targets of an ARM function in the ROM, word-aligned and above the entry, ascending, as ARM', () => {
  const rom = romWith([], { size: 0x400 });
  const adrs = [0x0800_0300, F - 4, F, F + 4, 0x0800_0202, rom.end - 4, rom.end];
  const f = factOf(readingOf(rom, { entry: F, mode: 'arm' }), { adrs });
  assert.deepEqual(adr.queue(f, viewWith({ rom })), [
    { entry: F + 4, mode: 'arm', proposedBy: 'seed.adr', cites: [F] },
    { entry: 0x0800_0300, mode: 'arm', proposedBy: 'seed.adr', cites: [F] },
    { entry: rom.end - 4, mode: 'arm', proposedBy: 'seed.adr', cites: [F] },
  ]);
});

test('a Thumb function\'s add rd, pc targets are not proposed', () => {
  const rom = romWith([]);
  const f = factOf(readingOf(rom, { entry: F }), { adrs: [F + 0x40] });
  assert.deepEqual(adr.queue(f, viewWith({ rom })), []);
  assert.equal(adr.meta.origin, 'adr');
});
