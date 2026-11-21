// bench/src/large-rom-image.ts: the 32 MiB synthetic ROM of g3.large-rom is deterministic (its SHA-1 is
// pinned here, so a change to the fixtures or the layout shows), exactly 32 MiB, a valid cartridge; and the
// layout on a small image: the startup, a tile with its pointers moved, the pointer to its main, seeded
// data, 0xFF padding.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRom, compareCodeUnits, headerComplement } from 'romlift';
import { sha1Of } from 'romlift/node';

import { xorshift32 } from '../../../bench/src/large-rom-image.ts';
import { FIXTURE_STARTUP_END, LARGE_ROM_BYTES, largeRomImage, readFixtureRoms } from '../../helpers/large-rom.ts';
import { prngSequence, xorshift32 as productXorshift32 } from '../../helpers/prng.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The SHA-1 of the default image over the committed fixtures; it changes only with them or with the layout. */
const PINNED_SHA1 = '71f15485cd62bd3f715ca3520cfe11655eb5ad4d';

test('the default image is 32 MiB, deterministic, pinned, and a cartridge romlift accepts', async () => {
  const fixtures = (await readFixtureRoms(REPO_ROOT)).map((f) => f.bytes);
  assert.ok(fixtures.length > 0);
  const first = largeRomImage(fixtures);
  const second = largeRomImage(fixtures);
  assert.equal(first.length, LARGE_ROM_BYTES);
  assert.equal(first.length, 33_554_432);
  assert.equal(sha1Of(first), sha1Of(second));
  assert.ok(Buffer.from(first).equals(Buffer.from(second)));
  assert.equal(sha1Of(first), PINNED_SHA1);
  assert.equal(first[0xbd], headerComplement(first));
  assert.deepEqual(checkRom(first), []);
});

test('readFixtureRoms reads every committed fixture ROM in name order', async () => {
  const roms = await readFixtureRoms(REPO_ROOT);
  const names = roms.map((r) => r.name);
  assert.deepEqual(names, [...names].sort(compareCodeUnits));
  assert.ok(names.includes('far-jump') && !names.includes('common'));
  for (const r of roms) assert.ok(r.bytes.length > FIXTURE_STARTUP_END, r.name);
});

test('the bench xorshift32 is the product generator', () => {
  let state = 0x524f4d4c;
  const expected = prngSequence(state, 1000);
  for (let i = 0; i < expected.length; i++) {
    state = xorshift32(state);
    assert.equal(state, expected[i]);
  }
  assert.equal(xorshift32(1), productXorshift32(1));
  assert.throws(() => xorshift32(0), RangeError);
});

function rom(code: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(FIXTURE_STARTUP_END + code.length * 4);
  const view = new DataView(bytes.buffer);
  bytes[0xbd] = 0x42;
  view.setUint32(FIXTURE_STARTUP_END - 4, 0x0800_00f5, true); // main, Thumb, at the startup's end
  code.forEach((word, i) => view.setUint32(FIXTURE_STARTUP_END + i * 4, word, true));
  return bytes;
}

test('layout: startup of the first fixture, then each tile with its pointers moved, a pointer to its main, seeded data, 0xFF', () => {
  const a = rom([0x4770_b500, 0x0800_00f9, 0x0900_0000]); // code, a pointer into itself (moved), one outside (kept)
  const b = rom([0x4770_4770]);
  const bytes = 0x2000;
  const image = largeRomImage([a, b], { bytes, seed: 7 });
  const view = new DataView(image.buffer);
  assert.equal(image.length, bytes);
  assert.ok(
    Buffer.from(image.subarray(0, FIXTURE_STARTUP_END)).equals(Buffer.from(a.subarray(0, FIXTURE_STARTUP_END))),
  );
  let at = FIXTURE_STARTUP_END;
  assert.equal(view.getUint32(at, true), 0x4770_b500);
  assert.equal(view.getUint32(at + 4, true), 0x0800_00f9, 'the first tile sits where it was linked');
  assert.equal(view.getUint32(at + 8, true), 0x0900_0000);
  at += 12;
  assert.equal(view.getUint32(at, true), 0x0800_00f5, "the data block opens with a pointer to the tile's main");
  let state = xorshift32(7);
  const words = 256 + (state % 1792);
  for (let w = 0; w < words; w++) {
    state = xorshift32(state);
    assert.equal(view.getUint32(at + 4 + w * 4, true), state);
  }
  at += 4 + words * 4;
  assert.equal(view.getUint32(at, true), 0x4770_4770, 'the second fixture is the next tile');
  assert.equal(
    view.getUint32(at + 4, true),
    (0x0800_00f5 + at - FIXTURE_STARTUP_END) >>> 0,
    'its main pointer moved with it',
  );
  const last = largeRomImage([a, b], { bytes, seed: 7 });
  assert.ok(Buffer.from(image).equals(Buffer.from(last)));
  assert.notEqual(sha1Of(largeRomImage([a, b], { bytes, seed: 8 })), sha1Of(image));
  // b's tile, its main pointer and one data block, then 8 bytes: too few for a's 12-byte tile, so 0xFF.
  const end = FIXTURE_STARTUP_END + 4 + 4 + (256 + (xorshift32(7) % 1792)) * 4;
  const padded = largeRomImage([b, a], { bytes: end + 8, seed: 7 });
  assert.deepEqual([...padded.subarray(end)], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
});

test('largeRomImage refuses no fixture, a fixture without code, a bad size and a zero seed', () => {
  const a = rom([0x4770_4770]);
  assert.throws(() => largeRomImage([]), RangeError);
  assert.throws(() => largeRomImage([a.subarray(0, FIXTURE_STARTUP_END)]), RangeError);
  assert.throws(() => largeRomImage([a], { bytes: 0x1001 }), RangeError);
  assert.throws(() => largeRomImage([a], { bytes: FIXTURE_STARTUP_END }), RangeError);
  assert.throws(() => largeRomImage([a], { seed: 0 }), RangeError);
});
