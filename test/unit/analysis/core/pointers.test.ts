import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPointerIndex, isPointedAt, isThumbPointer, pointersTo, pointerTargets } from '../../../../src/core/analysis/pointers.ts';
import { romWith, words } from '../../../helpers/analysis.ts';

test("the index holds every aligned Thumb pointer to a word-aligned ROM address (the PoC's dataRefs)", () => {
  const rom = romWith([
    { at: 0x0800_0200, bytes: words(0x0800_0301, 0x0800_0301, 0x0800_0303, 0x0800_0300, 0x0300_0001, 0x0800_0401) },
    // an unaligned word that looks like a pointer is not scanned
    { at: 0x0800_0222, bytes: words(0x0800_0501) },
  ], { size: 0x800 });
  const index = buildPointerIndex(rom);
  assert.deepEqual([...pointersTo(index, 0x0800_0300)], [0x200, 0x204]);
  assert.equal(isPointedAt(index, 0x0800_0302), false, 'target not word-aligned');
  assert.equal(isPointedAt(index, 0x0300_0000), false, 'not in the ROM');
  assert.equal(isPointedAt(index, 0x0800_0400), true);
  assert.equal(isPointedAt(index, 0x0800_0500), false);
  assert.deepEqual([...pointerTargets(index)], [0x0800_0300, 0x0800_0400]);
  assert.equal(isThumbPointer(rom, 0x0800_0301), true);
  assert.equal(isThumbPointer(rom, rom.end + 1), false);
  assert.equal(isThumbPointer(rom, rom.end - 3), true, 'the last word of the ROM');
});
