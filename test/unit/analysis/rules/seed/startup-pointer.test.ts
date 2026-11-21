import assert from 'node:assert/strict';
import { test } from 'node:test';

import startupPointer from '../../../../../src/core/analysis/rules/seed/startup-pointer.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';

const ARM1 = 0x0800_0100;
const THUMB = 0x0800_0200;
const ARM2 = 0x0800_0300;

test('Thumb pointers of the accepted ARM functions, in acceptance order, then walk order', () => {
  const rom = romWith([], { size: 0x800 });
  const arm1 = readingOf(rom, {
    entry: ARM1,
    mode: 'arm',
    pools: [
      { addr: ARM1 + 0x14, value: 0x0800_0501 },
      { addr: ARM1 + 0x10, value: 0x0800_0401 },
      { addr: ARM1 + 0x18, value: 0x0800_0600 },
      { addr: ARM1 + 0x1c, value: 0x0800_0603 },
    ],
  });
  const thumb = readingOf(rom, { entry: THUMB, pools: [{ addr: THUMB + 8, value: 0x0800_0701 }] });
  const arm2 = readingOf(rom, { entry: ARM2, mode: 'arm', pools: [{ addr: ARM2 + 8, value: 0x0800_0441 }] });
  const v = viewWith({ rom, functions: [ARM2, THUMB, ARM1], readings: [arm1, thumb, arm2] });
  assert.deepEqual(startupPointer.seeds(v), [
    { entry: 0x0800_0440, mode: 'thumb', cites: [ARM2 + 8, ARM2] },
    { entry: 0x0800_0500, mode: 'thumb', cites: [ARM1 + 0x14, ARM1] },
    { entry: 0x0800_0400, mode: 'thumb', cites: [ARM1 + 0x10, ARM1] },
  ]);
});

test('the target must lie in the ROM: the last word is in, the ROM end is out', () => {
  const rom = romWith([], { size: 0x800 });
  const arm = readingOf(rom, {
    entry: ARM1,
    mode: 'arm',
    pools: [
      { addr: ARM1 + 8, value: rom.end - 3 },
      { addr: ARM1 + 12, value: rom.end + 1 },
    ],
  });
  const v = viewWith({ rom, functions: [ARM1], readings: [arm] });
  assert.deepEqual(
    startupPointer.seeds(v).map((c) => c.entry),
    [rom.end - 4],
  );
});

test('no accepted ARM function, no proposal', () => {
  const rom = romWith([]);
  const thumb = readingOf(rom, { entry: THUMB, pools: [{ addr: THUMB + 8, value: 0x0800_0301 }] });
  assert.deepEqual(startupPointer.seeds(viewWith({ rom, functions: [THUMB], readings: [thumb] })), []);
  assert.equal(startupPointer.meta.origin, 'startup-pointer');
});
