// thumbWordAt (foundation/rom/rom.ts): the word @match-kit/isa's `decode` takes for Thumb, read from a Rom.
import { decode } from '@match-kit/isa/armv4t';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romFromBytes, thumbWordAt } from '../../../src/foundation/rom/rom.ts';

test('thumbWordAt pairs a halfword with the next one, and reads zero past the end of the ROM', () => {
  const bytes = new Uint8Array(0x200);
  bytes.set([0x01, 0xf0, 0x02, 0xf8], 0x100);
  bytes.set([0xc0, 0x46], 0x1fe);
  const rom = romFromBytes(bytes, 'test');
  assert.equal(thumbWordAt(rom, 0x0800_0100), 0xf802_f001);
  assert.equal(decode('thumb', thumbWordAt(rom, 0x0800_0100), 0x0800_0100).flow.kind, 'bl');
  assert.equal(thumbWordAt(rom, 0x0800_01fe), 0x46c0, 'the last halfword has nothing above it');
});
