import assert from 'node:assert/strict';
import { test } from 'node:test';

import poolPointer from '../../../../src/core/analysis/rules/seed/pool-pointer.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';

const F = 0x0800_0100;
const G = 0x0800_0200;

test('Thumb pointers in the pools of accepted functions (both modes), not yet functions, once each, ascending', () => {
  const rom = romWith([], { size: 0x800 });
  const f = readingOf(rom, {
    entry: F,
    pools: [
      { addr: F + 0x10, value: 0x0800_0601 },
      { addr: F + 0x14, value: G + 1 },
      { addr: F + 0x18, value: 0x0800_0600 },
      { addr: F + 0x1c, value: 0x0800_0503 },
    ],
  });
  const g = readingOf(rom, { entry: G, mode: 'arm', pools: [{ addr: G + 8, value: 0x0800_0601 }, { addr: G + 12, value: 0x0800_0401 }] });
  const v = viewWith({ rom, functions: [F, G], readings: [f, g] });
  assert.deepEqual(poolPointer.harvest(v, new Set()), [0x0800_0400, 0x0800_0600]);
});

test('the target must lie in the ROM: the last word is in, the ROM end is out', () => {
  const rom = romWith([], { size: 0x800 });
  const f = readingOf(rom, { entry: F, pools: [{ addr: F + 8, value: rom.end + 1 }, { addr: F + 12, value: rom.end - 3 }] });
  assert.deepEqual(poolPointer.harvest(viewWith({ rom, functions: [F], readings: [f] }), new Set()), [rom.end - 4]);
});

test('no accepted pools, nothing harvested', () => {
  const rom = romWith([]);
  assert.deepEqual(poolPointer.harvest(viewWith({ rom }), new Set()), []);
  assert.equal(poolPointer.meta.origin, 'pool-pointer');
});
