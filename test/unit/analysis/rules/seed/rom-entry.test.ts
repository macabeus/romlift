import assert from 'node:assert/strict';
import { test } from 'node:test';

import romEntry from '../../../../../src/core/analysis/rules/seed/rom-entry.ts';
import { BASE, romWith, viewWith, words } from '../../../../helpers/analysis.ts';

test('the ARM b at 0x08000000 proposes the cartridge start, then its target, both ARM', () => {
  const v = viewWith({ rom: romWith([], { entry: 0x0800_00c0 }) });
  assert.deepEqual(romEntry.seeds(v), [
    { entry: BASE, mode: 'arm', cites: [BASE] },
    { entry: 0x0800_00c0, mode: 'arm', cites: [BASE] },
  ]);
});

test('a conditional b counts, as the PoC decodes any condition but 0xF as b', () => {
  const v = viewWith({ rom: romWith([{ at: BASE, bytes: words(0x0a00_002e) }]) });
  assert.deepEqual(
    romEntry.seeds(v).map((c) => c.entry),
    [BASE, 0x0800_00c0],
  );
});

test('a ROM that does not start with b proposes nothing', () => {
  assert.deepEqual(romEntry.seeds(viewWith({ rom: romWith([]) })), [], 'a zero word');
  assert.deepEqual(romEntry.seeds(viewWith({ rom: romWith([{ at: BASE, bytes: words(0xeb00_002e) }]) })), [], 'bl');
  assert.deepEqual(
    romEntry.seeds(viewWith({ rom: romWith([{ at: BASE, bytes: words(0xfa00_002e) }]) })),
    [],
    'condition 0xF',
  );
});

test('its metadata names the rom-entry origin', () => {
  assert.equal(romEntry.kind, 'seed');
  assert.equal(romEntry.meta.origin, 'rom-entry');
});

test('a truncated image whose startup word is not wholly in the ROM proposes only the b, never a function with an empty extent', () => {
  const half = viewWith({ rom: romWith([], { entry: 0x0800_00c0, size: 0xc2 }) });
  assert.deepEqual(romEntry.seeds(half), [{ entry: BASE, mode: 'arm', cites: [BASE] }], 'the header plus one halfword');
  const whole = viewWith({ rom: romWith([], { entry: 0x0800_00c0, size: 0xc4 }) });
  assert.deepEqual(
    romEntry.seeds(whole).map((c) => c.entry),
    [BASE, 0x0800_00c0],
    'the header plus one word',
  );
});
