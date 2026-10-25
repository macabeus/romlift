// core/signatures/extract.ts (architecture §7.1, §7.2, D31, roadmap 6.A): the masks per instruction kind and of
// address-like words, member sizes, the function symbol of an address, merging references by identity, the link
// order, table names, reviewed names and the duplicate refusal, the refusals of malformed inputs, and determinism.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractSignatures, isAddressLike, maskMember, signatureFileText } from '../../../../src/core/signatures/extract.ts';
import { hexBytes } from '../../../../src/foundation/util/hex.ts';
import type { ExtractResult, ReferenceInput } from '../../../../src/core/signatures/extract.ts';
import { parseSignatureFile } from '../../../../src/core/signatures/schema.ts';
import type { LibraryVersion, SignatureFile } from '../../../../src/core/signatures/schema.ts';
import type { SignatureSpec } from '../../../../src/core/signatures/spec.ts';
import { words } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { reference, symbol, testRom } from './helpers.ts';

// ---------------------------------------------------------------------------------------------------
// Masks.

/** Thumb at 0x08000200: push, bl, beq inside, bne leaving, b inside, b leaving, pop; then two pool words. */
const THUMB_CODE = thumbAt(0x0800_0200)`push {lr}; bl _08000300; beq _0800020C; bne _08000280; b _0800020E; b _08000290; pop {pc}`;
/** ARM at 0x08000240: bl, b inside, b leaving, bx lr; then a pool word holding a ROM address. */
const ARM_CODE = armAt(0x0800_0240)`bl _08000300; b _0800024C; b _08000400; bx lr`;

const MASK_ROM = testRom([
  { at: 0x0800_0200, bytes: THUMB_CODE },
  { at: 0x0800_0210, bytes: words(0x0300_1234, 0x0000_1234) },
  { at: 0x0800_0240, bytes: ARM_CODE },
  { at: 0x0800_0250, bytes: words(0x0800_0123) },
  { at: 0x0800_0270, bytes: Uint8Array.from([0x70, 0x47, 0x34, 0x12]) },
  { at: 0x0800_0274, bytes: words(0x0200_1000) },
]);

function insns(entries: readonly (readonly [number, 2 | 4, 'thumb' | 'arm'])[]): ReadonlyMap<number, { readonly size: 2 | 4; readonly mode: 'thumb' | 'arm' }> {
  return new Map(entries.map(([a, size, mode]) => [a, { size, mode }] as const));
}

test('Thumb masks: a bl pair 00 f8 00 f8, a b leaving 00 f8, a bcc leaving 00 ff; branches inside and other instructions kept', () => {
  const code = insns([
    [0x0800_0200, 2, 'thumb'],
    [0x0800_0202, 4, 'thumb'],
    [0x0800_0206, 2, 'thumb'],
    [0x0800_0208, 2, 'thumb'],
    [0x0800_020a, 2, 'thumb'],
    [0x0800_020c, 2, 'thumb'],
    [0x0800_020e, 2, 'thumb'],
  ]);
  const { bytes, mask } = maskMember(MASK_ROM, code, 0x0800_0200, 0x0800_0218);
  assert.equal(hexBytes(bytes), `${hexBytes(THUMB_CODE)}3412000334120000`);
  // push | bl | beq inside | bne leaving | b inside | b leaving | pop | IWRAM pool word | constant
  assert.equal(hexBytes(mask), 'ffff00f800f8ffff00ffffff00f8ffff00000000ffffffff');
});

test('ARM masks: bl and a b leaving 00 00 00 ff, a b inside kept, a ROM address in the pool dropped whole', () => {
  const code = insns([
    [0x0800_0240, 4, 'arm'],
    [0x0800_0244, 4, 'arm'],
    [0x0800_0248, 4, 'arm'],
    [0x0800_024c, 4, 'arm'],
  ]);
  const { mask } = maskMember(MASK_ROM, code, 0x0800_0240, 0x0800_0254);
  assert.equal(hexBytes(mask), '000000ffffffffff000000ffffffffff00000000');
});

test('outside instructions: an unaligned halfword is stepped over, then the aligned word is judged', () => {
  const { mask } = maskMember(MASK_ROM, insns([[0x0800_0270, 2, 'thumb']]), 0x0800_0270, 0x0800_0278);
  assert.equal(hexBytes(mask), 'ffffffff00000000');
  // A trailing halfword (no whole word fits before the end) is kept.
  assert.equal(hexBytes(maskMember(MASK_ROM, new Map(), 0x0800_0274, 0x0800_0276).mask), 'ffff');
});

test('address-like words: top byte 0x02, 0x03 or 0x08 to 0x0D', () => {
  for (const w of [0x0200_0000, 0x02ff_ffff, 0x0300_0000, 0x03ff_ffff, 0x0800_0000, 0x0aaa_aaaa, 0x0dff_ffff]) assert.ok(isAddressLike(w), w.toString(16));
  for (const w of [0x0000_0000, 0x01ff_ffff, 0x0400_0000, 0x0700_0000, 0x0e00_0000, 0xffff_ffff, 0x0000_1234]) assert.ok(!isAddressLike(w), w.toString(16));
});

// ---------------------------------------------------------------------------------------------------
// Members, merging, link order and names.

const ROM_A = testRom([
  { at: 0x0800_0300, bytes: thumbAt(0x0800_0300)`movs r0, #1; bx lr; movs r0, #2; bx lr; movs r0, #3; bx lr; movs r0, #4; bx lr` },
  { at: 0x0800_0400, bytes: words(0x0800_0301, 0x0000_0010, 0x0800_0305, 0x0800_0999) },
]);
const ROM_B = testRom([{ at: 0x0800_0500, bytes: thumbAt(0x0800_0500)`movs r0, #3; bx lr; movs r0, #9; bx lr; movs r0, #1; bx lr` }]);

const CODE_A = [{ start: 0x0800_0300, end: 0x0800_0310, mode: 'thumb' as const }];
const CODE_B = [{ start: 0x0800_0500, end: 0x0800_050c, mode: 'thumb' as const }];

/** Reference A links a.o (One, Two) and b.o (Three, Four); a table T in d.o names One and Two. */
function refA(): ReferenceInput {
  return reference(
    'ref-a',
    ROM_A,
    CODE_A,
    [
      symbol('One', 0x0800_0300, 0, 'thumb'),
      symbol('local_one', 0x0800_0300, 4, 'thumb', 'local'),
      symbol('Two', 0x0800_0304, 100, 'thumb'),
      symbol('Three', 0x0800_0308, 4, 'thumb', 'local'),
      symbol('Four', 0x0800_030c, 0, 'thumb'),
      symbol('T', 0x0800_0400, 0, 'object'),
      symbol('Next', 0x0800_0410, 4, 'object'),
    ],
    [
      { object: 'build/lib.a(a.o)', start: 0x0800_0300, size: 8 },
      { object: 'src/b.o', start: 0x0800_0308, size: 6 },
      { object: 'src/game.o', start: 0x0800_0310, size: 0x20 },
    ],
    [{ object: 'src/d.o', start: 0x0800_0400, size: 0x20 }],
  );
}

/** Reference B links Three again (the same id, b.o), One as a global of another object, and Five, which is new. */
function refB(): ReferenceInput {
  return reference(
    'ref-b',
    ROM_B,
    CODE_B,
    [symbol('Three', 0x0800_0500, 4, 'thumb', 'local'), symbol('Five', 0x0800_0504, 4, 'thumb'), symbol('One', 0x0800_0508, 4, 'thumb')],
    [
      { object: 'other/b.o', start: 0x0800_0500, size: 4 },
      { object: 'other/libx.o', start: 0x0800_0504, size: 8 },
    ],
  );
}

const SPEC: SignatureSpec = {
  library: 'libt',
  versions: [
    {
      id: '1',
      idNote: 'the test version',
      references: [
        { dataset: 'ref-a', objects: ['lib.a(*)', 'b.o'], tables: ['T', 'Absent'] },
        { dataset: 'ref-b', objects: ['other/*.o'] },
      ],
    },
  ],
  reviewedNames: {},
};

function built(result: ExtractResult): { readonly file: SignatureFile; readonly version: LibraryVersion; readonly codes: readonly string[] } {
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  const version = result.value.versions[0];
  assert.ok(version !== undefined);
  return { file: result.value, version, codes: result.diagnostics.map((d) => d.code) };
}

test('members: the FUNC symbols of the matching .text placements; the first global symbol of an address wins over a local', () => {
  const { version } = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  assert.deepEqual(
    version.functions.map((f) => f.id),
    ['One@a.o', 'Two@a.o', 'Three@b.o', 'Four@b.o', 'Five@libx.o'],
  );
  assert.ok(version.functions.every((f) => f.mode === 'thumb'));
});

test('sizes: the least of the ELF size (0 unbounded), the distance to the next member and the placement end', () => {
  const { version } = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  const size = (id: string): number | undefined => version.functions.find((f) => f.id === id)?.size;
  assert.equal(size('One@a.o'), 4, 'ELF size 0: the next member');
  assert.equal(size('Two@a.o'), 4, 'ELF size 100: the placement end');
  assert.equal(size('Three@b.o'), 4, 'the ELF size');
  assert.equal(size('Four@b.o'), 2, 'ELF size 0, last of its placement: the placement end');
  assert.equal(version.functions.find((f) => f.id === 'Four@b.o')?.bytes, '0420');
});

test('merging: a later reference adds only members whose identity (the id, or the same global symbol) earlier ones lack', () => {
  const { version } = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  // Three@b.o of ref-b is the same id; One of other/libx.o is the global One; Five is new.
  assert.equal(version.functions.filter((f) => f.name === 'One').length, 1);
  assert.equal(version.functions.find((f) => f.id === 'One@a.o')?.bytes, '01207047', "the earlier reference's bytes");
});

test('link order: per reference, every member it contributed or matched, at its address there, in address order', () => {
  const { version } = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  assert.deepEqual(version.linkOrder, [
    {
      reference: 'ref-a',
      members: [
        { id: 'One@a.o', addr: 0x0800_0300 },
        { id: 'Two@a.o', addr: 0x0800_0304 },
        { id: 'Three@b.o', addr: 0x0800_0308 },
        { id: 'Four@b.o', addr: 0x0800_030c },
        { id: 'T@d.o', addr: 0x0800_0400 },
      ],
    },
    {
      reference: 'ref-b',
      members: [
        { id: 'Three@b.o', addr: 0x0800_0500 },
        { id: 'Five@libx.o', addr: 0x0800_0504 },
        { id: 'One@a.o', addr: 0x0800_0508 },
      ],
    },
  ]);
  assert.deepEqual(version.references, [
    { dataset: 'ref-a', commit: 'ref-a-commit', romSha1: ROM_A.sha1 },
    { dataset: 'ref-b', commit: 'ref-b-commit', romSha1: ROM_B.sha1 },
  ]);
});

test('tables: sized by the next typed symbol, their object from the data placement, names for the words naming a function member', () => {
  const { version, codes } = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  assert.deepEqual(version.tables, [
    {
      id: 'T@d.o',
      name: 'T',
      size: 16,
      bytes: '01030008100000000503000899090008',
      mask: '00000000ffffffff0000000000000000',
      names: ['One@a.o', null, 'Two@a.o', null],
    },
  ]);
  assert.deepEqual(codes, ['W_SIGNATURE_TABLE_MISSING'], 'the table Absent is skipped with a warning');
});

test('a table no word of which names a function member has no names; an unaligned one has none either', () => {
  const rom = testRom([{ at: 0x0800_0300, bytes: thumbAt(0x0800_0300)`bx lr` }, { at: 0x0800_0402, bytes: words(0x0800_0301, 7) }]);
  const input = reference(
    'r',
    rom,
    [{ start: 0x0800_0300, end: 0x0800_0302, mode: 'thumb' }],
    [symbol('F', 0x0800_0300, 2, 'thumb'), symbol('Plain', 0x0800_0410, 8, 'object'), symbol('Odd', 0x0800_0402, 8, 'object')],
    [{ object: 'f.o', start: 0x0800_0300, size: 2 }],
    [{ object: 'f.o', start: 0x0800_0400, size: 0x20 }],
  );
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['f.o'], tables: ['Plain', 'Odd'] }] }], reviewedNames: {} };
  const { version } = built(extractSignatures(spec, [[input]], '0'));
  assert.deepEqual(
    version.tables.map((t) => [t.id, t.size, 'names' in t]),
    [
      ['Plain@f.o', 8, false],
      ['Odd@f.o', 8, false],
    ],
  );
});

test('a table without a size and without a typed symbol after it is skipped with W_SIGNATURE_TABLE_UNSIZED', () => {
  const input = reference('r', ROM_A, CODE_A, [symbol('One', 0x0800_0300, 4, 'thumb'), symbol('Tail', 0x0800_0400, 0, 'object')], [{ object: 'a.o', start: 0x0800_0300, size: 4 }], [{ object: 'a.o', start: 0x0800_0400, size: 4 }]);
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['a.o'], tables: ['Tail'] }] }], reviewedNames: {} };
  const { version, codes } = built(extractSignatures(spec, [[input]], '0'));
  assert.deepEqual(version.tables, []);
  assert.deepEqual(codes, ['W_SIGNATURE_TABLE_UNSIZED']);
});

test('a table in no placement of the map is refused (E_SIGNATURE_TABLE_UNPLACED): it has no object', () => {
  const input = reference('r', ROM_A, CODE_A, [symbol('One', 0x0800_0300, 4, 'thumb'), symbol('T', 0x0800_0400, 4, 'object')], [{ object: 'a.o', start: 0x0800_0300, size: 4 }]);
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['a.o'], tables: ['T'] }] }], reviewedNames: {} };
  const result = extractSignatures(spec, [[input]], '0');
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_SIGNATURE_TABLE_UNPLACED']);
});

test('two statics of one name in two objects are two members, refused with one display name until the spec reviews one', () => {
  const rom = testRom([{ at: 0x0800_0300, bytes: thumbAt(0x0800_0300)`movs r0, #1; bx lr; movs r0, #2; bx lr` }]);
  const input = reference(
    'r',
    rom,
    [{ start: 0x0800_0300, end: 0x0800_0308, mode: 'thumb' }],
    [symbol('_parts', 0x0800_0300, 4, 'thumb', 'local'), symbol('_parts', 0x0800_0304, 4, 'thumb', 'local')],
    [
      { object: 'libgcc.a(dp-bit.o)', start: 0x0800_0300, size: 4 },
      { object: 'libgcc.a(fp-bit.o)', start: 0x0800_0304, size: 4 },
    ],
  );
  const spec: SignatureSpec = { library: 'libgcc', versions: [{ id: 'agbcc', idNote: '', references: [{ dataset: 'r', objects: ['libgcc.a(*)'] }] }], reviewedNames: {} };
  const refused = extractSignatures(spec, [[input]], '0');
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.diagnostics.map((d) => d.code), ['E_SIGNATURE_NAME_DUPLICATE']);
  assert.match(refused.diagnostics[0]?.message ?? '', /_parts@dp-bit\.o, _parts@fp-bit\.o/);

  const reviewed: SignatureSpec = { ...spec, reviewedNames: { '_parts@fp-bit.o': { name: '_parts_f', reason: 'unique labels' } } };
  const { version } = built(extractSignatures(reviewed, [[input]], '0'));
  assert.deepEqual(
    version.functions.map((f) => [f.id, f.name]),
    [
      ['_parts@dp-bit.o', '_parts'],
      ['_parts@fp-bit.o', '_parts_f'],
    ],
  );
});

test('a reviewed name of no member is a warning (W_SIGNATURE_REVIEWED_UNUSED); one that collides is refused', () => {
  const unused: SignatureSpec = { ...SPEC, reviewedNames: { 'Gone@a.o': { name: 'Gone', reason: 'r' } } };
  assert.deepEqual(built(extractSignatures(unused, [[refA(), refB()]], '0')).codes, ['W_SIGNATURE_TABLE_MISSING', 'W_SIGNATURE_REVIEWED_UNUSED']);
  const colliding: SignatureSpec = { ...SPEC, reviewedNames: { 'Five@libx.o': { name: 'Two', reason: 'r' } } };
  const result = extractSignatures(colliding, [[refA(), refB()]], '0');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'E_SIGNATURE_NAME_DUPLICATE'));
});

test('a later reference whose member of one identity differs under both masks is a warning; the earlier bytes stay', () => {
  const rom = testRom([{ at: 0x0800_0500, bytes: thumbAt(0x0800_0500)`movs r0, #7; bx lr` }]);
  const differs = reference('ref-b', rom, [{ start: 0x0800_0500, end: 0x0800_0504, mode: 'thumb' }], [symbol('One', 0x0800_0500, 4, 'thumb')], [{ object: 'other/x.o', start: 0x0800_0500, size: 4 }]);
  const { version, codes } = built(extractSignatures(SPEC, [[refA(), differs]], '0'));
  assert.ok(codes.includes('W_SIGNATURE_MEMBER_DIFFERS'));
  assert.equal(version.functions.find((f) => f.id === 'One@a.o')?.bytes, '01207047');
});

test('one reference linking one identity twice is refused (E_SIGNATURE_MEMBER_DUPLICATE)', () => {
  const rom = testRom([{ at: 0x0800_0300, bytes: thumbAt(0x0800_0300)`movs r0, #1; bx lr; movs r0, #2; bx lr` }]);
  const input = reference(
    'r',
    rom,
    [{ start: 0x0800_0300, end: 0x0800_0308, mode: 'thumb' }],
    [symbol('helper', 0x0800_0300, 4, 'thumb', 'local'), symbol('helper', 0x0800_0304, 4, 'thumb', 'local')],
    [
      { object: 'src/one/x.o', start: 0x0800_0300, size: 4 },
      { object: 'src/two/x.o', start: 0x0800_0304, size: 4 },
    ],
  );
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['x.o'] }] }], reviewedNames: {} };
  const result = extractSignatures(spec, [[input]], '0');
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_SIGNATURE_MEMBER_DUPLICATE']);
});

test('refusals: globs matching no .text placement, a symbol without a member id, inputs not in the spec order', () => {
  const unmatched: SignatureSpec = { ...SPEC, versions: [{ id: '1', idNote: '', references: [{ dataset: 'ref-a', objects: ['nothing.o'] }] }] };
  assert.deepEqual(extractSignatures(unmatched, [[refA()]], '0').diagnostics.map((d) => d.code), ['E_SIGNATURE_OBJECTS_UNMATCHED']);

  const noId = reference('r', ROM_A, CODE_A, [symbol('One', 0x0800_0300, 4, 'thumb')], [{ object: 'a.obj', start: 0x0800_0300, size: 4 }]);
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['a.obj'] }] }], reviewedNames: {} };
  assert.deepEqual(extractSignatures(spec, [[noId]], '0').diagnostics.map((d) => d.code), ['E_SIGNATURE_MEMBER_ID_INVALID']);

  for (const inputs of [[[refB(), refA()]], [[refA()]], [], [[refA(), refB()], []]]) {
    const result = extractSignatures(SPEC, inputs, '0');
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_SIGNATURE_REFERENCES_MISMATCH']);
  }
});

test('a member running past the ROM end is refused (E_SIGNATURE_MEMBER_OUTSIDE_ROM)', () => {
  const rom = testRom([{ at: 0x0800_03fc, bytes: thumbAt(0x0800_03fc)`movs r0, #1; bx lr` }], 0x400);
  const input = reference('r', rom, [], [symbol('Edge', 0x0800_03fc, 8, 'thumb')], [{ object: 'e.o', start: 0x0800_03fc, size: 8 }]);
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['e.o'] }] }], reviewedNames: {} };
  assert.deepEqual(extractSignatures(spec, [[input]], '0').diagnostics.map((d) => d.code), ['E_SIGNATURE_MEMBER_OUTSIDE_ROM']);
});

test('instruction boundaries come from the code spans: a word inside decoded code is never judged as an address', () => {
  // `ldr r0, [pc, #0]; bx lr` then the pool: 0x0300_0000 is masked only because it is not an instruction.
  const rom = testRom([{ at: 0x0800_0300, bytes: Uint8Array.from([0x00, 0x48, 0x70, 0x47, 0x00, 0x00, 0x00, 0x03]) }]);
  const symbols = [symbol('Load', 0x0800_0300, 8, 'thumb')];
  const placements = [{ object: 'l.o', start: 0x0800_0300, size: 8 }];
  const spec: SignatureSpec = { library: 'l', versions: [{ id: '1', idNote: '', references: [{ dataset: 'r', objects: ['l.o'] }] }], reviewedNames: {} };
  const asData = built(extractSignatures(spec, [[reference('r', rom, [{ start: 0x0800_0300, end: 0x0800_0304, mode: 'thumb' }], symbols, placements)]], '0'));
  assert.equal(asData.version.functions[0]?.mask, 'ffffffff00000000');
  const asCode = built(extractSignatures(spec, [[reference('r', rom, [{ start: 0x0800_0300, end: 0x0800_0308, mode: 'thumb' }], symbols, placements)]], '0'));
  assert.equal(asCode.version.functions[0]?.mask, 'ffffffffffffffff');
});

test('the file: schema 3, every version in spec order, valid for parseSignatureFile, its text identical across builds', () => {
  const first = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  const second = built(extractSignatures(SPEC, [[refA(), refB()]], '9.9.9'));
  assert.equal(first.file.schema, 3);
  assert.equal(first.file.library, 'libt');
  assert.equal(first.file.builtWith, '9.9.9');
  assert.equal(signatureFileText(first.file), signatureFileText(second.file));
  assert.ok(signatureFileText(first.file).endsWith('}\n'));
  const parsed = parseSignatureFile(JSON.parse(signatureFileText(first.file)));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.deepEqual(parsed.value, first.file);
});
