// Shared paths (architecture §6.2, §6.3, D62, D74 f): function and orphan files per module, the case-fold rule
// (every member of a collision group gets its address), module sources and build units in ROM order, a C module's
// stub, assembly and object.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assembleUnits, buildUnits, cAssemblyPath, chunkNamesOf, chunkPaths, cObjectPath, CRT0_PATH, HEADER_PATH, MODULES_MK_PATH, modulePathPrefixes, moduleSource, objectPath } from '../../../src/core/model/paths.ts';
import { isCSource, isHeaderPath } from '../../../src/foundation/util/project-files.ts';
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

test('assembleUnits: each build unit with its own module span, built from the module (architecture-r1-10)', () => {
  const m = model();
  const units = assembleUnits(m);
  assert.deepEqual(units.map(({ span: _span, ...unit }) => unit), buildUnits(m));
  assert.deepEqual(units.map((u) => u.span), m.modules.map((x) => x.span));
});

test('the path prefixes of a module: its source, and its nonmatchings directory when it has files there', () => {
  const m = model();
  assert.deepEqual(modulePathPrefixes(m, m.modules[2]!), ['asm/main.s', 'asm/nonmatchings/main/']);
  assert.deepEqual(modulePathPrefixes(m, m.modules[4]!), ['data/data.s']);
  assert.deepEqual(modulePathPrefixes(m, m.modules[0]!), ['asm/rom_header.s']);
});

test('a C module builds src/<m>.c through build/src/<m>.s to build/src/<m>.o; its prefixes are its stub and its directory (D74 f)', () => {
  const m = model();
  const c = { ...m, modules: m.modules.map((x) => (x.name === 'main' ? { ...x, kind: 'c' as const } : x)) };
  assert.deepEqual(buildUnits(c)[2], { module: 'main', source: 'src/main.c', object: 'build/src/main.o' });
  assert.deepEqual(assembleUnits(c)[2], { module: 'main', source: 'src/main.c', object: 'build/src/main.o', span: c.modules[2]!.span });
  assert.deepEqual(buildUnits(c).filter((_, i) => i !== 2), buildUnits(m).filter((_, i) => i !== 2), 'the other units keep build/<m>.o');
  assert.equal(cObjectPath('main'), 'build/src/main.o');
  assert.equal(cAssemblyPath('main'), 'build/src/main.s');
  assert.equal(objectPath('main'), 'build/main.o');
  assert.deepEqual(['src/main.c', 'asm/main.s', 'data/data.s'].map(isCSource), [true, false, false]);
  // The one header predicate of the shell's src/*.h listing and the reconciler's unread includes (architecture-d1-3).
  assert.deepEqual(['src/local.h', 'global.h', 'src/main.c', 'include/macros.inc'].map(isHeaderPath), [true, true, false, false]);
  assert.deepEqual(modulePathPrefixes(c, c.modules[2]!), ['src/main.c', 'asm/nonmatchings/main/']);
  assert.equal(MODULES_MK_PATH, 'modules.mk');
  // The header's module keeps its file and object whatever its kind says.
  const header = { ...c, modules: c.modules.map((x) => (x.name === 'rom_header' ? { ...x, kind: 'c' as const } : x)) };
  assert.deepEqual(buildUnits(header)[0], { module: 'rom_header', source: HEADER_PATH, object: 'build/rom_header.o' });
});

test('chunkNamesOf reads the chunk names back from chunk files: base names, and the names of a case-folded group', () => {
  const files = [
    'asm/nonmatchings/main/VBlankCB_080000C0.s',
    'asm/nonmatchings/main/VblankCB_080000E0.s',
    'asm/nonmatchings/main/sub_08000100.s',
    'asm/nonmatchings/main/sub_08000200.s',
    'asm/nonmatchings/main_2/AgbMain.s',
    'asm/nonmatchings/main_2/Solo_08000300.s',
    'asm/main.s',
    'asm/nonmatchings/main/notes.txt',
  ];
  assert.deepEqual(chunkNamesOf(files), ['AgbMain', 'Solo_08000300', 'VBlankCB', 'VBlankCB_080000C0', 'VblankCB', 'VblankCB_080000E0', 'sub_08000100', 'sub_08000200']);
  assert.deepEqual(chunkNamesOf([]), []);
  // The inverse of chunkPaths: every chunk name of a model is among the names its files give back.
  const rom = romWith([], { size: 0x200 });
  const model = modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'main', kind: 'c', chunks: [{ name: 'VBlankCB', items: [dataItem(0x0800_00c0, 0x20)] }, { name: 'VblankCB', items: [dataItem(0x0800_00e0, 0x20)] }, { kind: 'orphan', name: 'unk_08000100', items: [dataItem(0x0800_0100, 0x100)] }] },
    ],
  });
  const names = chunkNamesOf(chunkPaths(model).flatMap((p) => (p === undefined ? [] : [p])));
  for (const chunk of model.chunks.slice(1)) assert.ok(names.includes(chunk.name), chunk.name);
});
