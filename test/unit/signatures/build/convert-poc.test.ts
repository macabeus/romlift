// bench/tools/convert-poc-signatures.ts (architecture §7.1, D31, roadmap 6.A): the PoC's schema-2 signature files to
// schema 3. Project names become dataset names, member ids come from the reference map's objects (the `_2` suffixes
// undone), link orders are rebuilt from each reference's own map and ELF, pointers become member ids, and a PoC
// member the reference does not have is refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { convertPocFile, datasetOfProject, parsePocFile, type PocFile, type PocSpec, type ReferenceBuild } from '../../../../bench/tools/convert-poc-signatures.ts';
import { symbol } from './helpers.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const POC: PocFile = {
  schema: 2,
  library: 'libgcc',
  versions: [
    {
      version: 'agbcc',
      note: 'the note',
      references: [
        { project: 'pokeemerald', commit: '731ad5bfd', romSha1: SHA_A },
        { project: 'FireEmblem7J', commit: 'f27a029', romSha1: SHA_B },
      ],
      functions: [
        { name: '_fpadd_parts', ref: 0, refAddr: 0x0800_0100, size: 4, bytes: '00207047', mask: 'ffffffff', mode: 'thumb' },
        { name: '_fpadd_parts_2', ref: 0, refAddr: 0x0800_0104, size: 4, bytes: '01207047', mask: 'ffffffff', mode: 'thumb' },
        { name: '__ashldi3', ref: 1, refAddr: 0x0800_0208, size: 4, bytes: '02207047', mask: 'ffffffff', mode: 'thumb' },
      ],
      objects: [{ name: 'gTable', ref: 0, refAddr: 0x0800_0300, size: 8, bytes: '0101000810000000', mask: '00000000ffffffff', pointers: ['_fpadd_parts', null] }],
    },
  ],
};

const SPEC: PocSpec = {
  library: 'libgcc',
  versions: [
    {
      version: 'agbcc',
      references: [
        { project: 'pokeemerald', objects: ['libgcc.a(*)'], symbols: ['gTable'] },
        { project: 'FireEmblem7J', objects: ['libgcc.a(*)'] },
      ],
    },
  ],
};

const EMERALD: ReferenceBuild = {
  dataset: 'pokeemerald',
  commit: '731ad5bfd',
  sha1: SHA_A,
  romEnd: 0x0800_1000,
  symbols: [symbol('_fpadd_parts', 0x0800_0100, 4, 'thumb', 'local'), symbol('_fpadd_parts', 0x0800_0104, 4, 'thumb', 'local'), symbol('gTable', 0x0800_0300, 8, 'object')],
  text: [
    { object: 'lib/libgcc.a(dp-bit.o)', start: 0x0800_0100, size: 4 },
    { object: 'lib/libgcc.a(fp-bit.o)', start: 0x0800_0104, size: 4 },
  ],
  data: [{ object: 'lib/libgcc.a(tables.o)', start: 0x0800_0300, size: 8 }],
};

const FE7J: ReferenceBuild = {
  dataset: 'fe7j',
  commit: 'f27a029',
  sha1: SHA_B,
  romEnd: 0x0800_1000,
  symbols: [symbol('_fpadd_parts', 0x0800_0200, 4, 'thumb', 'local'), symbol('_fpadd_parts', 0x0800_0204, 4, 'thumb', 'local'), symbol('__ashldi3', 0x0800_0208, 4, 'thumb')],
  text: [
    { object: '../tools/libgcc.a(dp-bit.o)', start: 0x0800_0200, size: 4 },
    { object: '../tools/libgcc.a(fp-bit.o)', start: 0x0800_0204, size: 4 },
    { object: '../tools/libgcc.a(_ashldi3.o)', start: 0x0800_0208, size: 4 },
  ],
  data: [],
};

const builds = (dataset: string): ReferenceBuild => {
  if (dataset === 'pokeemerald') return EMERALD;
  if (dataset === 'fe7j') return FE7J;
  throw new Error(dataset);
};

test('PoC project names become dataset names', () => {
  assert.equal(datasetOfProject('kleod'), 'klonoa');
  assert.equal(datasetOfProject('FireEmblem7J'), 'fe7j');
  assert.equal(datasetOfProject('sa2'), 'sa2');
});

test('ids from the maps (the _2 suffix undone), references from the datasets, bytes and order kept, pointers as ids', () => {
  const file = convertPocFile(parsePocFile(JSON.parse(JSON.stringify(POC)), 'poc'), SPEC, builds);
  assert.equal(file.schema, 3);
  const version = file.versions[0];
  assert.ok(version !== undefined);
  assert.equal(version.idNote, 'the note');
  assert.deepEqual(version.references, [
    { dataset: 'pokeemerald', commit: '731ad5bfd', romSha1: SHA_A },
    { dataset: 'fe7j', commit: 'f27a029', romSha1: SHA_B },
  ]);
  assert.deepEqual(
    version.functions.map((f) => [f.id, f.name, f.bytes]),
    [
      ['_fpadd_parts@dp-bit.o', '_fpadd_parts', '00207047'],
      ['_fpadd_parts@fp-bit.o', '_fpadd_parts', '01207047'],
      ['__ashldi3@_ashldi3.o', '__ashldi3', '02207047'],
    ],
  );
  assert.deepEqual(version.tables, [{ id: 'gTable@tables.o', name: 'gTable', size: 8, bytes: '0101000810000000', mask: '00000000ffffffff', names: ['_fpadd_parts@dp-bit.o', null] }]);
  assert.deepEqual(version.linkOrder, [
    {
      reference: 'pokeemerald',
      members: [
        { id: '_fpadd_parts@dp-bit.o', addr: 0x0800_0100 },
        { id: '_fpadd_parts@fp-bit.o', addr: 0x0800_0104 },
        { id: 'gTable@tables.o', addr: 0x0800_0300 },
      ],
    },
    {
      reference: 'fe7j',
      members: [
        { id: '_fpadd_parts@dp-bit.o', addr: 0x0800_0200 },
        { id: '_fpadd_parts@fp-bit.o', addr: 0x0800_0204 },
        { id: '__ashldi3@_ashldi3.o', addr: 0x0800_0208 },
      ],
    },
  ]);
});

test('refused: a PoC member its reference lacks, and a ROM SHA-1 other than the dataset one', () => {
  const missing: PocFile = { ...POC, versions: POC.versions.map((v) => ({ ...v, functions: [...v.functions, { name: 'Ghost', ref: 1, refAddr: 0x0800_0400, size: 4, bytes: '00000000', mask: 'ffffffff', mode: 'thumb' as const }] })) };
  assert.throws(() => convertPocFile(missing, SPEC, builds), /Ghost/);
  const otherRom: PocFile = { ...POC, versions: POC.versions.map((v) => ({ ...v, references: v.references.map((r) => ({ ...r, romSha1: 'c'.repeat(40) })) })) };
  assert.throws(() => convertPocFile(otherRom, SPEC, builds), /ROM is c{40}/);
});

test('parsePocFile refuses anything but schema 2', () => {
  assert.throws(() => parsePocFile({ ...POC, schema: 3 }, 'x'), /schema 2/);
  assert.throws(() => parsePocFile({ schema: 2, library: 'l', versions: [{ version: 'v' }] }, 'x'), /malformed/);
});
