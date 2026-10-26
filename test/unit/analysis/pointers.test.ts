import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressMap } from '../../../src/core/analysis/address-map.ts';
import { buildPointerIndex, isPointedAt, isThumbPointer, pointersTo, pointerTargets, thumbPointerTarget } from '../../../src/core/analysis/pointers.ts';
import { romWith, words } from '../../helpers/analysis.ts';

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

test('a value below the ROM, an even value or a misaligned target is no Thumb pointer', () => {
  const rom = romWith([], { size: 0x400 });
  assert.equal(isThumbPointer(rom, 0x0000_0001), false, 'below the ROM base');
  assert.equal(isThumbPointer(rom, 0x07ff_fffd), false, 'just below the ROM base');
  assert.equal(isThumbPointer(rom, 0x0800_0300), false, 'even');
  assert.equal(isThumbPointer(rom, 0x0800_0303), false, 'target not word-aligned');
  assert.equal(isThumbPointer(rom, rom.end - 7), true);
});

test('thumbPointerTarget: isThumbPointer on the identity map; through a runs_at range by run address, never by load address', () => {
  const rom = romWith([], { size: 0x800 });
  const identity = addressMap([]);
  for (const v of [0x0800_0301, 0x0800_0300, 0x0800_0303, 0x0300_0001, rom.end + 1]) assert.equal(thumbPointerTarget(rom, identity, v), isThumbPointer(rom, v) ? v - 1 : undefined);
  const m = addressMap([{ span: { start: 0x0800_0400, end: 0x0800_0500 }, kind: 'code', runsAt: 0x0300_0000 }]);
  assert.equal(thumbPointerTarget(rom, m, 0x0300_0011), 0x0800_0410);
  assert.equal(thumbPointerTarget(rom, m, 0x0300_0013), undefined, 'a load address off its word');
  assert.equal(thumbPointerTarget(rom, m, 0x0300_0010), undefined, 'even');
  assert.equal(thumbPointerTarget(rom, m, 0x0300_0101), undefined, 'RAM past the range');
  assert.equal(thumbPointerTarget(rom, m, 0x0800_0401), undefined, 'the copy source');
  assert.equal(thumbPointerTarget(rom, m, 0x0800_0301), 0x0800_0300, 'outside the range, as before');
});
