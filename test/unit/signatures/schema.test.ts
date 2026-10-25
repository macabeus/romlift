// parseSignatureFile and parseSignatureSpec (architecture §7.1, D31, D93, D95 d): the zod validators of the frozen
// schema-3 signature file and of a spec. Each accepts exactly its shape, refuses anything else with the path of the
// offending member, and never throws.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isMemberId, parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile } from '../../../src/core/signatures/schema.ts';
import { parseSignatureSpec } from '../../../src/core/signatures/spec.ts';
import type { SignatureSpec } from '../../../src/core/signatures/spec.ts';

const FILE: SignatureFile = {
  schema: 3,
  library: 'libgcc',
  builtWith: '0.0.0',
  versions: [
    {
      id: 'agbcc',
      idNote: 'the libgcc agbcc ships',
      references: [{ dataset: 'pokeemerald', commit: '731ad5bfd', romSha1: 'f3ae088181bf583e55daf962a92bb46f4f1d07b7' }],
      linkOrder: [
        {
          reference: 'pokeemerald',
          members: [
            { id: '_fpadd_parts@dp-bit.o', addr: 0x082e_70d0 },
            { id: '_fpadd_parts@fp-bit.o', addr: 0x082e_7400 },
          ],
        },
      ],
      functions: [
        { id: '_fpadd_parts@dp-bit.o', name: '_fpadd_parts', mode: 'thumb', size: 2, bytes: '00b5', mask: 'ffff' },
        { id: '_fpadd_parts@fp-bit.o', name: '_fpadd_parts', mode: 'arm', size: 4, bytes: '1eff2fe1', mask: 'ffffffff' },
      ],
      tables: [{ id: 'gClockTable@m4a.o', name: 'gClockTable', size: 9, bytes: '000102030405060708', mask: 'ffffffffffffffffff', names: [null, null] }],
    },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The refusal of `file` with `edit` applied to a clone of it. */
function refusal(edit: (file: Record<string, unknown> & { versions: Record<string, unknown>[] }) => void): string {
  const file = clone(FILE) as unknown as Record<string, unknown> & { versions: Record<string, unknown>[] };
  edit(file);
  const parsed = parseSignatureFile(file);
  assert.equal(parsed.ok, false, 'expected a refusal');
  return parsed.ok ? '' : parsed.error;
}

test('a schema-3 file decodes to itself', () => {
  assert.deepEqual(parseSignatureFile(clone(FILE)), { ok: true, value: FILE });
  const noNames = clone(FILE);
  const { names: _names, ...table } = noNames.versions[0]?.tables[0] ?? FILE.versions[0]!.tables[0]!;
  const withoutNames = { ...noNames, versions: [{ ...noNames.versions[0]!, tables: [table] }] };
  assert.deepEqual(parseSignatureFile(withoutNames), { ok: true, value: withoutNames }, 'names is optional');
});

test('member ids are <symbol>@<object>.o, object paths allowed', () => {
  for (const id of ['_fpadd_parts@dp-bit.o', 'm4aSoundMain@src/lib/m4a/m4a0.o', 'a@b.o']) assert.ok(isMemberId(id), id);
  for (const id of ['_fpadd_parts', '@dp-bit.o', 'a@.o', 'a@b.c', 'a@b@c.o', 'a b@c.o', 'a@b .o', '']) assert.ok(!isMemberId(id), id);
});

test('the top level: schema 3 only, every key present, no other key', () => {
  assert.equal(refusal((f) => (f['schema'] = 2)), 'file.schema: is 2, not 3');
  assert.equal(refusal((f) => delete f['builtWith']), "file: missing key 'builtWith'");
  assert.equal(refusal((f) => (f['builtAt'] = '2026-10-16')), "file: unknown key 'builtAt'");
  assert.equal(refusal((f) => (f['library'] = '')), 'file.library: must be a non-empty string');
  for (const value of [null, 3, 'x', [], undefined]) {
    const parsed = parseSignatureFile(value);
    assert.deepEqual(parsed, { ok: false, error: 'file: must be an object' });
  }
});

test('versions, references and link order are checked member by member', () => {
  assert.equal(refusal((f) => (f.versions[0]!['references'] = [{ dataset: 'sa2', commit: 'x', romSha1: 'ABC' }])), 'file.versions[0].references[0].romSha1: must be a lower-case hex SHA-1');
  assert.equal(refusal((f) => (f.versions[0]!['references'] = [{ project: 'sa2', commit: 'x', romSha1: '0'.repeat(40) }])), "file.versions[0].references[0]: unknown key 'project'");
  assert.equal(refusal((f) => (f.versions[0]!['linkOrder'] = [{ reference: 'sa2', members: ['_fpadd_parts@dp-bit.o'] }])), 'file.versions[0].linkOrder[0].members[0]: must be an object');
  assert.equal(refusal((f) => (f.versions[0]!['linkOrder'] = [{ reference: 'sa2', members: [{ id: 'x@y.o', addr: -1 }] }])), 'file.versions[0].linkOrder[0].members[0].addr: must be an integer from 0 to 0xFFFFFFFF');
  assert.equal(refusal((f) => delete f.versions[0]!['tables']), "file.versions[0]: missing key 'tables'");
});

test('function and table members: ids, modes, sizes, and bytes and masks of exactly their size in lower-case hex', () => {
  const fn = (patch: Record<string, unknown>) => (f: { versions: Record<string, unknown>[] }) => {
    const functions = f.versions[0]!['functions'] as Record<string, unknown>[];
    Object.assign(functions[0]!, patch);
  };
  assert.equal(refusal(fn({ id: '_fpadd_parts_dp' })), "file.versions[0].functions[0].id: '_fpadd_parts_dp' is not a member id (<symbol>@<object>.o)");
  assert.equal(refusal(fn({ mode: 'thumb2' })), "file.versions[0].functions[0].mode: must be 'thumb' or 'arm'");
  assert.equal(refusal(fn({ size: 0 })), 'file.versions[0].functions[0].size: must be an integer from 1 to 0xFFFFFFFF');
  assert.equal(refusal(fn({ bytes: '00B5' })), 'file.versions[0].functions[0].bytes: must be lower-case hex, two digits per byte');
  assert.equal(refusal(fn({ mask: 'ff' })), "file.versions[0].functions[0].mask: holds 1 bytes, the member's size is 2");
  assert.equal(refusal(fn({ ref: 0 })), "file.versions[0].functions[0]: unknown key 'ref'");
  const table = (patch: Record<string, unknown>) => (f: { versions: Record<string, unknown>[] }) => {
    const tables = f.versions[0]!['tables'] as Record<string, unknown>[];
    Object.assign(tables[0]!, patch);
  };
  assert.equal(refusal(table({ names: [null] })), 'file.versions[0].tables[0].names: holds 1 entries, the table has 2 aligned words');
  assert.equal(refusal(table({ names: ['gFoo', null] })), "file.versions[0].tables[0].names[0]: 'gFoo' is not a member id (<symbol>@<object>.o)");
  assert.equal(refusal(table({ mode: 'thumb' })), "file.versions[0].tables[0]: unknown key 'mode'");
});

const SPEC: SignatureSpec = {
  library: 'm4a',
  versions: [
    { id: '2001', idNote: 'Klonoa, sa2, sa3 and fe7j', references: [{ dataset: 'sa2', objects: ['src/lib/m4a/m4a0.o', 'src/lib/m4a/m4a.o'], tables: ['gScaleTable'] }] },
    { id: '2004', idNote: 'Emerald', references: [{ dataset: 'pokeemerald', objects: ['src/m4a_1.o'] }] },
  ],
  reviewedNames: { 'MP2K_event_fine@m4a0.o': { name: 'ply_fine', reason: 'the name pret and fe7j use' } },
};

function specRefusal(edit: (spec: Record<string, unknown> & { versions: Record<string, unknown>[] }) => void): string {
  const spec = clone(SPEC) as unknown as Record<string, unknown> & { versions: Record<string, unknown>[] };
  edit(spec);
  const parsed = parseSignatureSpec(spec);
  assert.equal(parsed.ok, false, 'expected a refusal');
  return parsed.ok ? '' : parsed.error;
}

test('a spec decodes to itself; tables are optional', () => {
  assert.deepEqual(parseSignatureSpec(clone(SPEC)), { ok: true, value: SPEC });
});

test('a spec names a library, at least one version, references with objects, and reviewed names by member id', () => {
  assert.equal(specRefusal((s) => (s['versions'] = [])), 'spec.versions: names no version');
  assert.equal(specRefusal((s) => (s.versions[0]!['references'] = [])), 'spec.versions[0].references: names no reference');
  assert.equal(specRefusal((s) => (s.versions[0]!['references'] = [{ dataset: 'sa2', objects: [] }])), 'spec.versions[0].references[0].objects: names no object');
  assert.equal(specRefusal((s) => (s.versions[0]!['references'] = [{ project: 'sa2', objects: ['a.o'] }])), "spec.versions[0].references[0]: unknown key 'project'");
  assert.equal(specRefusal((s) => (s['reviewedNames'] = { ply_fine: { name: 'x', reason: 'y' } })), "spec.reviewedNames.ply_fine: 'ply_fine' is not a member id (<symbol>@<object>.o)");
  assert.equal(specRefusal((s) => (s['reviewedNames'] = { 'a@b.o': { name: 'x' } })), "spec.reviewedNames.a@b.o: missing key 'reason'");
  assert.equal(specRefusal((s) => delete s['reviewedNames']), "spec: missing key 'reviewedNames'");
  assert.deepEqual(parseSignatureSpec('m4a'), { ok: false, error: 'spec: must be an object' });
});
