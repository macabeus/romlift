import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { checkRom, contains, ROM_BASE, romFromBytes, u16, u32, u8 } from '../../../src/foundation/rom/rom.ts';
import { syntheticRom } from './synthetic.ts';

test('romFromBytes maps the image at 0x08000000 and parses the header', () => {
  const bytes = syntheticRom({ title: 'TINY GAME', gameCode: 'ATNE', makerCode: '01', version: 2 });
  const rom = romFromBytes(bytes, 'ab'.repeat(20));
  assert.equal(rom.base, ROM_BASE);
  assert.equal(rom.end, ROM_BASE + bytes.length);
  assert.equal(rom.bytes, bytes);
  assert.equal(rom.sha1, 'ab'.repeat(20));
  assert.deepEqual(rom.header, { title: 'TINY GAME', gameCode: 'ATNE', makerCode: '01', version: 2 });
});

test('romFromBytes never throws on an empty or garbage image', () => {
  const empty = romFromBytes(new Uint8Array(0), '');
  assert.equal(empty.end, ROM_BASE);
  assert.deepEqual(empty.header, { title: '', gameCode: '', makerCode: '', version: 0 });
  const garbage = romFromBytes(new Uint8Array(0x10).fill(0xff), '');
  assert.equal(garbage.header.version, 0);
});

test('u8, u16 and u32 read little-endian at bus addresses, up to the last byte', () => {
  const bytes = new Uint8Array([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff, 0xaa, 0xbb]);
  const rom = romFromBytes(bytes, '');
  assert.equal(u8(rom, ROM_BASE), 0x78);
  assert.equal(u16(rom, ROM_BASE), 0x5678);
  assert.equal(u32(rom, ROM_BASE), 0x1234_5678);
  assert.equal(u32(rom, ROM_BASE + 4), 0xffff_ffff, 'unsigned');
  assert.equal(u16(rom, ROM_BASE + 1), 0x3456, 'unaligned halfword');
  assert.equal(u16(rom, ROM_BASE + 8), 0xbbaa, 'last halfword');
  assert.equal(u8(rom, ROM_BASE + 9), 0xbb, 'last byte');
  assert.equal(u32(rom, ROM_BASE + 6), 0xbbaa_ffff, 'last word');
});

test('reads outside the ROM are invariant violations', () => {
  const rom = romFromBytes(new Uint8Array(8), '');
  assert.throws(() => u8(rom, ROM_BASE - 1), RomliftInvariantError);
  assert.throws(() => u8(rom, ROM_BASE + 8), RomliftInvariantError);
  assert.throws(() => u16(rom, ROM_BASE + 7), RomliftInvariantError);
  assert.throws(() => u32(rom, ROM_BASE + 5), RomliftInvariantError);
  assert.throws(() => u8(rom, ROM_BASE + 0.5), RomliftInvariantError);
});

test('contains checks that a whole range lies inside the ROM', () => {
  const rom = romFromBytes(new Uint8Array(16), '');
  assert.equal(contains(rom, ROM_BASE), true);
  assert.equal(contains(rom, ROM_BASE + 15), true);
  assert.equal(contains(rom, ROM_BASE + 16), false);
  assert.equal(contains(rom, ROM_BASE + 12, 4), true);
  assert.equal(contains(rom, ROM_BASE + 13, 4), false);
  assert.equal(contains(rom, ROM_BASE + 16, 0), true, 'an empty range at the end');
  assert.equal(contains(rom, ROM_BASE - 1, 2), false);
  assert.equal(contains(rom, 0x0300_0000, 1), false);
  assert.equal(contains(rom, ROM_BASE, -1), false);
});

test('checkRom accepts a valid synthetic header', () => {
  assert.deepEqual(checkRom(syntheticRom()), []);
});

test('checkRom rejects an image shorter than the header', () => {
  for (const size of [0, 0x10, 0xbf]) {
    const found = checkRom(new Uint8Array(size));
    assert.equal(found.length, 1);
    assert.equal(found[0]?.code, 'E_ROM_NOT_GBA');
    assert.equal(found[0]?.severity, 'error');
  }
  assert.deepEqual(checkRom(syntheticRom({ size: 0xc0 })), [], 'exactly the header is enough');
});

test('checkRom rejects a wrong fixed byte and a wrong complement, with their addresses', () => {
  const badFixed = syntheticRom();
  badFixed[0xb2] = 0x00;
  const fixed = checkRom(badFixed);
  assert.ok(fixed.some((d) => d.code === 'E_ROM_NOT_GBA' && d.addr === ROM_BASE + 0xb2));

  const badComplement = syntheticRom();
  badComplement[0xbd] = (badComplement[0xbd] ?? 0) ^ 0xff;
  const complement = checkRom(badComplement);
  assert.equal(complement.length, 1);
  assert.equal(complement[0]?.addr, ROM_BASE + 0xbd);
  assert.match(complement[0]?.message ?? '', /complement/);
});

test('checkRom rejects an image larger than 32 MiB', () => {
  const found = checkRom(syntheticRom({ size: 0x0200_0001 }));
  assert.equal(found.length, 1);
  assert.match(found[0]?.message ?? '', /32 MiB/);
  assert.deepEqual(checkRom(syntheticRom({ size: 0x0200_0000 })), []);
});
