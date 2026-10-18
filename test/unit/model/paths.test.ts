// Shared paths (architecture §6.2, §6.3, D62): function and orphan files per module, the case-fold rule
// (every member of a collision group gets its address), module sources and build units in ROM order.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildUnits, chunkPaths, CRT0_PATH, HEADER_PATH, modulePathPrefixes, moduleSource } from '../../../src/core/model/paths.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';

function model() {
  const rom = romWith([], { size: 0x2000 });
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'crt0', chunks: [{ kind: 'startup', name: 'crt0', mode: 'arm', items: [dataItem(0x0800_00c0, 0x40)] }] },
      {
        name: 'main',
        chunks: [
          { name: 'VBlankCB', items: [dataItem(0x0800_0100, 0x10)] },
          { name: 'InitBgs', items: [dataItem(0x0800_0110, 0x10)] },
          { kind: 'orphan', name: 'unk_08000120', items: [dataItem(0x0800_0120, 0x10)] },
          { name: 'VblankCB', items: [dataItem(0x0800_0130, 0x10)] },
          { name: 'vblankcb', items: [dataItem(0x0800_0140, 0x10)] },
        ],
      },
      { name: 'other', chunks: [{ name: 'InitBGs', items: [dataItem(0x0800_0150, 0x10)] }] },
      { name: 'data', kind: 'data', generated: false, chunks: [{ kind: 'data', name: 'data', items: [dataItem(0x0800_0160, 0x1ea0)] }] },
    ],
  });
}

test('every member of a case-folded collision group in one directory is written with its address', () => {
  assert.deepEqual(chunkPaths(model()), [
    undefined,
    undefined,
    'asm/nonmatchings/main/VBlankCB_08000100.s',
    'asm/nonmatchings/main/InitBgs.s',
    'asm/nonmatchings/main/unk_08000120.s',
    'asm/nonmatchings/main/VblankCB_08000130.s',
    'asm/nonmatchings/main/vblankcb_08000140.s',
    'asm/nonmatchings/other/InitBGs.s',
    undefined,
  ]);
});

test('module sources and build units, in ROM order', () => {
  const m = model();
  assert.deepEqual(buildUnits(m), [
    { module: 'rom_header', source: HEADER_PATH, object: 'build/rom_header.o' },
    { module: 'crt0', source: CRT0_PATH, object: 'build/crt0.o' },
    { module: 'main', source: 'asm/main.s', object: 'build/main.o' },
    { module: 'other', source: 'asm/other.s', object: 'build/other.o' },
    { module: 'data', source: 'data/data.s', object: 'build/data.o' },
  ]);
  assert.equal(HEADER_PATH, 'asm/rom_header.s');
  assert.equal(CRT0_PATH, 'asm/crt0.s');
  const c = { ...m.modules[2]!, kind: 'c' as const };
  assert.equal(moduleSource(m, c), 'src/main.c');
});

test('the path prefixes of a module: its source, and its nonmatchings directory when it has files there', () => {
  const m = model();
  assert.deepEqual(modulePathPrefixes(m, m.modules[2]!), ['asm/main.s', 'asm/nonmatchings/main/']);
  assert.deepEqual(modulePathPrefixes(m, m.modules[4]!), ['data/data.s']);
  assert.deepEqual(modulePathPrefixes(m, m.modules[0]!), ['asm/rom_header.s']);
});
