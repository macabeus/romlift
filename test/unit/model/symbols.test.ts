// The model's symbols (architecture §6.2, §6.5): every config symbol in address order; the ones inside the ROM
// label data (and split a data module's chunks), the others are for symbols.ld.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { modelSymbols, romSymbols } from '../../../src/core/model/symbols.ts';
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
