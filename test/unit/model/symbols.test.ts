// The model's symbols (architecture §6.2, §6.5): every config symbol in address order; the ones inside the ROM
// label data (and split a data module's chunks), the others are for symbols.ld.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { externalSymbols, isOutsideRom, modelSymbols, romSymbols } from '../../../src/core/model/symbols.ts';
import { externalSymbolValues } from '../../../src/core/verify/link-scripts.ts';
import { BASE, configOf, romWith } from '../layout/hand-made.ts';

test('modelSymbols lists every config symbol by address; romSymbols keeps those inside the ROM', () => {
  const config = configOf({
    modules: [['rom_header', BASE]],
    symbols: [
      [BASE + 0x180, { name: 'gTable', size: 16, aliases: [] }],
      [0x0400_0000, { name: 'REG_DISPCNT', aliases: [] }],
      [0x0300_0000, { name: 'gRam', size: 4, type: 'bytes', aliases: ['gRamAlias'] }],
    ],
  });
  const symbols = modelSymbols(config);
  assert.deepEqual(symbols, [
    { addr: 0x0300_0000, name: 'gRam', size: 4 },
    { addr: 0x0400_0000, name: 'REG_DISPCNT' },
    { addr: BASE + 0x180, name: 'gTable', size: 16 },
  ]);
  assert.deepEqual(romSymbols(symbols, romWith([], { size: 0x200 })), [{ addr: BASE + 0x180, name: 'gTable', size: 16 }]);
  assert.deepEqual(romSymbols(symbols, romWith([], { size: 0x100 })), []);
});

test('externalSymbols: the one list of the symbols outside the ROM, which the writers print and the check reads by name (architecture-r1-6)', () => {
  const rom = { sha1: 'test', end: BASE + 0x200 };
  assert.equal(isOutsideRom(BASE - 1, rom), true);
  assert.equal(isOutsideRom(BASE, rom), false);
  assert.equal(isOutsideRom(BASE + 0x1ff, rom), false);
  assert.equal(isOutsideRom(BASE + 0x200, rom), true);
  const symbols = [
    { addr: 0x0400_0000, name: 'REG_DISPCNT' },
    { addr: 0x0300_0000, name: 'gRam' },
    { addr: BASE + 0x180, name: 'gTable' },
    { addr: 0x0200_0000, name: 'gRam' },
  ];
  const model = { symbols, rom };
  assert.deepEqual(externalSymbols(model).map((s) => [s.addr, s.name]), [[0x0200_0000, 'gRam'], [0x0300_0000, 'gRam'], [0x0400_0000, 'REG_DISPCNT']]);
  assert.deepEqual([...externalSymbolValues(model)], [['gRam', 0x0200_0000], ['REG_DISPCNT', 0x0400_0000]]);
});
