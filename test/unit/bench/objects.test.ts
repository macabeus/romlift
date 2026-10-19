// bench/src/objects.ts: the objects digest equals the gates' (test/gates/gate.ts objectsDigest over nodeIo)
// on one directory, the symbol index and objectFor, the relocation reader on the committed objdiff fixture
// objects, and the map-against-objects comparison.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseElf, parseGnuMap, type ElfSymbol } from 'romlift';

import {
  definitionsOf,
  indexObjectSymbols,
  linkedSectionMismatches,
  listObjectFiles,
  mapObjects,
  objectFor,
  implicitAddend,
  objectRelocations,
  objectsDigest,
  readObjectSymbolIndex,
} from '../../../bench/src/objects.ts';
import { nodeIo, objectsDigest as gateObjectsDigest } from '../../gates/gate.ts';
import { withTempDir } from './fixtures.ts';

const FIXTURES = new URL('../../fixtures/objdiff/', import.meta.url);
const REFERENCE_O = new URL('reference.o', FIXTURES);
const BASE_O = new URL('base.o', FIXTURES);

async function bytesOf(url: URL): Promise<Uint8Array> {
  return new Uint8Array(await readFile(url));
}

test('objectsDigest equals the gate framework digest: every .o under the directory, sorted, path NUL bytes', async () => {
  await withTempDir('romlift-objects-', async (dir) => {
    await mkdir(join(dir, 'src', 'game'), { recursive: true });
    await mkdir(join(dir, 'asm'), { recursive: true });
    await mkdir(join(dir, 'dir.o'), { recursive: true });
    await copyFile(REFERENCE_O, join(dir, 'src', 'game', 'b.o'));
    await copyFile(BASE_O, join(dir, 'asm', 'Z.o'));
    await writeFile(join(dir, 'src', 'a.o'), 'not an object, still hashed');
    await writeFile(join(dir, 'src', 'a.s'), 'ignored');
    await writeFile(join(dir, 'é.o'), 'non-ASCII path');
    await symlink(join(dir, 'asm', 'Z.o'), join(dir, 'link.o'));
    assert.deepEqual(await listObjectFiles(dir), ['asm/Z.o', 'src/a.o', 'src/game/b.o', 'é.o']);
    const digest = await objectsDigest(dir);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(digest, await gateObjectsDigest(dir, nodeIo));
    await writeFile(join(dir, 'src', 'a.o'), 'changed');
    assert.notEqual(await objectsDigest(dir), digest);
    assert.equal(await objectsDigest(dir), await gateObjectsDigest(dir, nodeIo));
  });
});

const sym = (name: string, bind: ElfSymbol['bind'], type: ElfSymbol['type'] = 'func', sectionIndex = 1): ElfSymbol => ({
  name,
  value: 0,
  addr: 0,
  size: 0,
  type,
  bind,
  thumb: false,
  sectionIndex,
});

test('objectFor: the one global (or weak) definition, else the one local; ambiguous and absent names give undefined', () => {
  const index = indexObjectSymbols([
    { object: 'src/b.o', symbols: [sym('Shared', 'global'), sym('sStatic', 'local'), sym('Twice', 'local'), sym('Weak', 'weak'), sym('$t', 'local', 'notype')] },
    { object: 'src/a.o', symbols: [sym('Shared', 'local'), sym('Dup', 'global'), sym('Twice', 'local'), sym('label_1', 'local', 'notype'), sym('.text', 'local', 'section')] },
    { object: 'src/c.o', symbols: [sym('Dup', 'global'), sym('Weak', 'global'), sym('gAbs', 'global', 'object', 0xfff1), sym('.Llocal', 'local', 'notype')] },
  ]);
  assert.equal(objectFor(index, 'Shared'), 'src/b.o');
  assert.equal(objectFor(index, 'sStatic'), 'src/b.o');
  assert.equal(objectFor(index, 'label_1'), 'src/a.o');
  assert.equal(objectFor(index, 'Weak'), 'src/c.o');
  assert.equal(objectFor(index, 'Dup'), undefined);
  assert.equal(objectFor(index, 'Twice'), undefined);
  assert.deepEqual(definitionsOf(index, 'Twice').map((d) => d.object), ['src/a.o', 'src/b.o']);
  for (const absent of ['$t', '.text', 'gAbs', '.Llocal', 'Missing']) assert.equal(objectFor(index, absent), undefined, absent);
});

test('readObjectSymbolIndex reads every object under the directory and names the unreadable ones', async () => {
  await withTempDir('romlift-objects-index-', async (dir) => {
    await mkdir(join(dir, 'ref'), { recursive: true });
    await copyFile(REFERENCE_O, join(dir, 'ref', 'reference.o'));
    await copyFile(BASE_O, join(dir, 'base.o'));
    await writeFile(join(dir, 'junk.o'), 'junk');
    const { index, unreadable } = await readObjectSymbolIndex(dir);
    assert.deepEqual(unreadable.map((u) => u.object), ['junk.o']);
    assert.equal(objectFor(index, 'sectData'), 'base.o');
    assert.equal(objectFor(index, 'SameFunc'), undefined, 'both objects define it globally');
    assert.deepEqual(definitionsOf(index, 'SameFunc').map((d) => d.object), ['base.o', 'ref/reference.o']);
    assert.equal(objectFor(index, 'gTarget'), undefined, 'an undefined symbol defines nothing');
  });
});

test('objectRelocations names each relocation symbol, a section symbol by its section', async () => {
  const relocations = objectRelocations(await bytesOf(REFERENCE_O));
  assert.ok(relocations.ok);
  assert.deepEqual(relocations.value, [
    { section: '.text', offset: 0x1c, type: 2, symbol: { name: 'gTarget', type: 'notype', bind: 'global', defined: false }, addend: 0 },
    { section: '.text', offset: 0x28, type: 2, symbol: { name: '.rodata', type: 'section', bind: 'local', defined: true }, addend: 0 },
  ]);
  const base = objectRelocations(await bytesOf(BASE_O));
  assert.ok(base.ok);
  assert.deepEqual(base.value.map((r) => [r.offset, r.symbol.name, r.symbol.type, r.symbol.defined]), [
    [0x1c, 'gOther', 'notype', false],
    [0x28, 'sectData', 'notype', true],
  ]);
  const junk = objectRelocations(new TextEncoder().encode('not an ELF'));
  assert.equal(junk.ok, false);
});

function mapText(textSize: number): string {
  return [
    'Archive member included to satisfy reference by file (symbol)',
    '',
    'Linker script and memory map',
    '',
    'LOAD ref/reference.o',
    'LOAD lib/libgcc.a',
    '',
    `.text           0x08000000       0x${(textSize + 8).toString(16)}`,
    ` .text          0x08000000       0x${textSize.toString(16)} ref/reference.o`,
    '                0x08000000                SameFunc',
    ' .text          0x08000030        0x8 lib/libgcc.a(_divsi3.o)',
    '',
    '.rodata         0x08000038        0x4',
    ' .rodata        0x08000038        0x4 ref/reference.o',
    '',
    '.debug_info     0x00000000      0x100',
    ' .debug_info    0x00000000      0x100 ref/reference.o',
    '',
  ].join('\n');
}

test('mapObjects lists the linked objects and archive members; linkedSectionMismatches compares code and data sizes', async () => {
  const parsed = parseGnuMap(mapText(0x2c));
  assert.ok(parsed.ok);
  const linked = mapObjects(parsed.value);
  assert.deepEqual(linked.archiveMembers, ['lib/libgcc.a(_divsi3.o)']);
  assert.deepEqual(linked.objects.map((o) => [o.file, [...o.sections.entries()]]), [['ref/reference.o', [['.text', 0x2c], ['.rodata', 4]]]]);
  const elf = parseElf(await bytesOf(REFERENCE_O));
  assert.ok(elf.ok);
  const object = linked.objects[0];
  assert.ok(object !== undefined);
  assert.deepEqual(linkedSectionMismatches(object, elf.value), []);
  const wrong = parseGnuMap(mapText(0x30));
  assert.ok(wrong.ok);
  const other = mapObjects(wrong.value).objects[0];
  assert.ok(other !== undefined);
  assert.deepEqual(linkedSectionMismatches(other, elf.value), ['ref/reference.o .text is 0x2c bytes, the map links 0x30']);
});

test('implicitAddend reads the addend each ARM REL type keeps in its field (architecture-r1-1)', () => {
  const view = (bytes: readonly number[]): DataView => new DataView(Uint8Array.from(bytes).buffer);
  assert.equal(implicitAddend(2, view([0x10, 0, 0, 0]), 0), 0x10, 'R_ARM_ABS32: the word');
  assert.equal(implicitAddend(2, view([0xfc, 0xff, 0xff, 0xff]), 0), -4);
  // R_ARM_THM_CALL: `bl .` as GNU as leaves it for a relocation, 0xF7FF 0xFFFE, is -4.
  assert.equal(implicitAddend(10, view([0xff, 0xf7, 0xfe, 0xff]), 0), -4);
  assert.equal(implicitAddend(10, view([0x00, 0xf0, 0x04, 0xf8]), 0), 8);
  assert.equal(implicitAddend(28, view([0xfe, 0xff, 0xff, 0xeb]), 0), -8, 'R_ARM_CALL: bl . in ARM state');
  assert.equal(implicitAddend(102, view([0xfe, 0xe7]), 0), -4, 'R_ARM_THM_JUMP11: b .');
  assert.equal(implicitAddend(103, view([0xfe, 0xd0]), 0), -4, 'R_ARM_THM_JUMP8: beq .');
  assert.equal(implicitAddend(5, view([0xff, 0xff]), 0), -1);
  assert.equal(implicitAddend(8, view([0x80]), 0), -128);
  assert.equal(implicitAddend(40, view([0, 0, 0, 0]), 0), undefined, 'R_ARM_V4BX changes no addend this reader knows');
});
