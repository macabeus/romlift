// The signatures family of the bench (bench/src/signatures.ts, architecture §8.4 "Signatures", D24, D25, D31): the
// judging classifiers on in-memory ELF symbols (functions at an ELF FUNC or an untyped row, tables an OBJECT of their
// size or a label, the size padding allowance and the spanning ELF size, the reference names), the sealed shape (counts
// only; leaking an address or a name fails the guard and the gate's leak pattern), the leave-one-out arithmetic, and
// `bench signatures` end to end on a tier built from the committed library fixtures: judged, sealed and --loo.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ElfSymbol, MemberId, Proposal, SignatureFile, SignaturePlacement, SignatureSpec } from 'romlift';
import { buildSignatures, sha1Of, sha256Of, writeSignatureFile } from 'romlift/node';

import { ROMLIFT_RUNNER } from '../../../bench/src/analysis-run.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import type { BenchContext } from '../../../bench/src/context.ts';
import { BenchError } from '../../../bench/src/files.ts';
import { assertCountsOnly } from '../../../bench/src/seal.ts';
import {
  BENCH_SIGNATURES_LOO_SCHEMA,
  BENCH_SIGNATURES_SCHEMA,
  benchSignatures,
  benchSignaturesLoo,
  classifyTable,
  elfIndex,
  isMappingSymbol,
  judgeSignatures,
  libraryPlacements,
  counterparts,
  looCounts,
  looPairs,
  memberSymbol,
  readBuiltSignatures,
  referenceVersions,
  replaceLibrary,
  sealedSignatures,
  sharedMembers,
  signaturesDigest,
  SIGNATURES_BUILD_LOOP,
  sizeAgrees,
  withoutReference,
  type BenchSignaturesLooReport,
  type BenchSignaturesReport,
  type JudgeInput,
} from '../../../bench/src/signatures.ts';
import { signatureFile } from '../../helpers/signatures.ts';
import { dataset, withTempDir } from './fixtures.ts';

const ROM_SIZE = 0x1000;

function sym(name: string, addr: number, size: number, type: ElfSymbol['type'] = 'func'): ElfSymbol {
  return { name, value: type === 'func' ? addr | 1 : addr, addr, size, type, bind: 'global', thumb: type === 'func', sectionIndex: 1 };
}

function placement(member: MemberId, addr: number, overrides: Partial<SignaturePlacement> = {}): SignaturePlacement {
  return { library: 'lib', version: '1', member, name: memberSymbol(member), kind: 'function', addr, size: 8, mode: 'thumb', rule: 'sig.unique-fit', ...overrides };
}

function table(member: MemberId, addr: number, size: number): SignaturePlacement {
  return { library: 'lib', version: '1', member, name: memberSymbol(member), kind: 'table', addr, size, rule: 'sig.unique-fit' };
}

const fnProposal = (addr: number, name: string, size?: number): Proposal => ({ kind: 'function', addr, mode: 'thumb', name, ...(size === undefined ? {} : { size }), source: { kind: 'signature', library: 'lib', version: '1', rule: 'sig.unique-fit' } });

/** A signature file naming `dataset` as the reference of lib@1. */
function referenceFile(datasetName: string): SignatureFile {
  const file = signatureFile('lib', { id: '1', members: [] });
  const v = file.versions[0];
  if (v === undefined) throw new Error('no version');
  return { ...file, versions: [{ ...v, references: [{ dataset: datasetName, commit: 'c', romSha1: '0'.repeat(40) }] }] };
}

// ---------------------------------------------------------------------------------------------------
// The classifiers.

test('elfIndex keeps the FUNC, OBJECT and NOTYPE symbols inside the ROM, the largest FUNC size, and no mapping symbol as a name', () => {
  const elf = elfIndex(
    [
      sym('A', 0x0800_0100, 8),
      sym('A_alias', 0x0800_0100, 12),
      sym('tbl', 0x0800_0200, 16, 'object'),
      sym('tbl_short', 0x0800_0200, 8, 'object'),
      sym('$d', 0x0800_0300, 0, 'notype'),
      sym('$t.1', 0x0800_0304, 0, 'notype'),
      sym('label', 0x0800_0308, 0, 'notype'),
      sym('.text', 0x0800_0400, 0, 'section'),
      sym('ram', 0x0300_0000, 4),
      sym('past', 0x0800_0000 + ROM_SIZE, 4),
    ],
    ROM_SIZE,
  );
  assert.deepEqual([...elf.funcSize], [[0x0800_0100, 12]]);
  assert.deepEqual([...elf.objectSizes], [[0x0800_0200, [16, 8]]]);
  assert.deepEqual([...elf.names.keys()], [0x0800_0100, 0x0800_0200, 0x0800_0308]);
  assert.deepEqual([...(elf.names.get(0x0800_0100) ?? [])], ['A', 'A_alias']);
  assert.ok(isMappingSymbol('$a') && isMappingSymbol('$d.12') && !isMappingSymbol('$data') && !isMappingSymbol('d'));
});

test('a FUNC whose size runs over the start of another FUNC is spanning: its size is no extent', () => {
  const elf = elfIndex([sym('whole_file', 0x0800_0100, 0x722), sym('next', 0x0800_010c, 0x20), sym('last', 0x0800_0900, 4)], ROM_SIZE);
  assert.deepEqual([...elf.spanning], [0x0800_0100]);
});

test('sizeAgrees allows the padding to the next 4-byte boundary on either side, and nothing else', () => {
  assert.ok(sizeAgrees(12, 12));
  assert.ok(sizeAgrees(28, 26), 'the ELF counts the padding');
  assert.ok(sizeAgrees(6, 8), 'the signature counts the padding');
  assert.ok(!sizeAgrees(8, 4));
  assert.ok(!sizeAgrees(12, 8));
  assert.ok(!sizeAgrees(10, 8));
});

test('classifyTable: an OBJECT of its size, a label where no OBJECT starts, else wrong', () => {
  const elf = elfIndex([sym('gTable', 0x0800_0200, 16, 'object'), sym('gUntyped', 0x0800_0300, 0, 'notype'), sym('$d', 0x0800_0400, 0, 'notype'), sym('Fn', 0x0800_0500, 32)], ROM_SIZE);
  assert.equal(classifyTable(elf, 0x0800_0200, 16), 'object-of-size');
  assert.equal(classifyTable(elf, 0x0800_0200, 12), 'wrong');
  assert.equal(classifyTable(elf, 0x0800_0300, 12), 'label');
  assert.equal(classifyTable(elf, 0x0800_0500, 12), 'label', 'any symbol that names the address');
  assert.equal(classifyTable(elf, 0x0800_0400, 12), 'wrong', 'a mapping symbol names nothing');
  assert.equal(classifyTable(elf, 0x0800_0600, 12), 'wrong');
});

test('judgeSignatures counts each classifier and names every placement, table, size and name that fails', () => {
  const elf = elfIndex(
    [sym('Good', 0x0800_0100, 8), sym('Sized', 0x0800_0110, 26), sym('Whole', 0x0800_0140, 0x400), sym('Inner', 0x0800_0150, 8), sym('Unsized', 0x0800_0600, 0), sym('gTable', 0x0800_0700, 16, 'object'), sym('label', 0x0800_0720, 0, 'notype'), sym('Theirs', 0x0800_0800, 8)],
    ROM_SIZE,
  );
  const input: JudgeInput = {
    dataset: 'tiny',
    elf,
    untyped: new Set([0x0800_0130]),
    files: [referenceFile('tiny')],
    placements: [
      placement('Good@a.o', 0x0800_0100),
      placement('Sized@a.o', 0x0800_0110, { size: 28 }),
      placement('Second@a.o', 0x0800_0130),
      placement('Nowhere@a.o', 0x0800_0134),
      placement('Whole@a.o', 0x0800_0140, { size: 16 }),
      placement('Unsized@a.o', 0x0800_0600),
      table('gTable@d.o', 0x0800_0700, 16),
      table('gLabel@d.o', 0x0800_0720, 8),
      table('gWrong@d.o', 0x0800_0740, 8),
      placement('Mine@a.o', 0x0800_0800, { name: 'Reviewed' }),
    ],
    proposals: [fnProposal(0x0800_0100, 'Good'), fnProposal(0x0800_0110, 'Sized', 28), fnProposal(0x0800_0140, 'Whole', 16), fnProposal(0x0800_0600, 'Unsized', 8), fnProposal(0x0800_0130, 'Second', 4), fnProposal(0x0800_0800, 'Reviewed', 12)],
  };
  const { member, problems } = judgeSignatures(input);
  assert.deepEqual(member.placements, { total: 7, atElfFunc: 5, atUntyped: 1, wrong: 1 });
  assert.deepEqual(member.tables, { total: 3, objectOfSize: 1, label: 1, wrong: 1 });
  // Sized 28 against 26 agrees (padding); Whole's ELF size spans Inner, Unsized has none, Second no FUNC: unjudged; Reviewed 12 against 8 differs.
  assert.deepEqual(member.sizes, { proposed: 5, equal: 1, differ: 1, unjudged: 3 });
  // Every placement is of lib@1, which names tiny as a reference: symbols compared; Mine is not the ELF's Theirs.
  assert.equal(member.names.reference, true);
  assert.equal(member.names.total, 10);
  assert.equal(member.names.differ, 5, 'Second, Nowhere, gWrong (nothing there), gLabel (label there) and Mine (Theirs there)');
  assert.equal(member.names.equal, 5);
  assert.equal(member.names.reviewed, 1);
  assert.deepEqual(member.libraries, [{ library: 'lib', version: '1', functions: 7, objects: 3 }]);
  assert.deepEqual(
    problems.filter((p) => !p.startsWith('name ')),
    [
      'placement 0x08000134 Nowhere (Nowhere@a.o, lib@1, sig.unique-fit): no ELF FUNC there and no untyped row',
      'table 0x08000740 gWrong (gWrong@d.o, lib@1, sig.unique-fit) size 8: no symbol there',
      "size 0x08000800 Reviewed: proposed 12, the ELF's 8",
    ],
  );
  assert.ok(problems.includes("name 0x08000800 Reviewed (Mine@a.o, lib@1, sig.unique-fit): this reference's symbol there is Theirs, not Mine"));
});

test('names are compared only for the versions the ROM is a reference of', () => {
  const elf = elfIndex([sym('Other', 0x0800_0100, 8)], ROM_SIZE);
  const base = { elf, untyped: new Set<number>(), placements: [placement('Mine@a.o', 0x0800_0100)], proposals: [] };
  const elsewhere = judgeSignatures({ ...base, dataset: 'tiny', files: [referenceFile('another')] });
  assert.deepEqual(elsewhere.member.names, { reference: false, total: 0, equal: 0, differ: 0, reviewed: 0 });
  assert.deepEqual(elsewhere.problems, []);
  assert.deepEqual([...referenceVersions([referenceFile('tiny')], 'tiny')], ['lib@1']);
  assert.equal(memberSymbol('_fpadd_parts@dp-bit.o'), '_fpadd_parts');
});

test('libraryPlacements counts functions and tables per library version, sorted by code unit', () => {
  const ps = [placement('a@x.o', 1, { library: 'm4a', version: '2004' }), { ...table('t@x.o', 2, 4), library: 'm4a', version: '2004' }, placement('b@x.o', 3, { library: 'Lib', version: '1' }), placement('c@x.o', 4, { library: 'm4a', version: '2001' })];
  assert.deepEqual(libraryPlacements(ps), [
    { library: 'Lib', version: '1', functions: 1, objects: 0 },
    { library: 'm4a', version: '2001', functions: 1, objects: 0 },
    { library: 'm4a', version: '2004', functions: 1, objects: 1 },
  ]);
});

// ---------------------------------------------------------------------------------------------------
// The sealed shape.

/** The gate's leak pattern (test/gates/g6.signatures-heldout.test.ts LEAK). */
const LEAK = /0x[0-9a-f]{5,}|"(addr|addrs|name|names|symbol|symbols|rows|labels)"\s*:/i;

test('a sealed entry holds counts only: the classifiers of §8.4 decide untyped, and nothing names an address or a symbol', () => {
  const elf = elfIndex([sym('Fn', 0x0800_0100, 64), sym('gTable', 0x0800_0700, 16, 'object')], ROM_SIZE);
  const entry = sealedSignatures({
    name: 'sealed',
    elf,
    placements: [
      placement('Fn@a.o', 0x0800_0100),
      placement('Inside@a.o', 0x0800_0120),
      placement('Wrong@a.o', 0x0800_0300),
      table('gTable@d.o', 0x0800_0700, 16),
      table('gNone@d.o', 0x0800_0800, 16),
    ],
    untypedClass: (addr) => (addr === 0x0800_0120 ? 'inside-elf-function' : 'other'),
  });
  assert.deepEqual(entry, { name: 'sealed', placements: { total: 3, atElfFunc: 1, untyped: 1, wrong: 1 }, tables: { total: 2, object: 1, label: 0, wrong: 1 } });
  assertCountsOnly(entry);
  const { name: _name, ...numbers } = entry;
  assert.doesNotMatch(JSON.stringify(numbers), LEAK);
});

test('mutation: a sealed entry that leaks an address or a name fails the guard; the gate\'s pattern catches a spelled one', () => {
  const entry = { name: 'sealed', placements: { total: 1, atElfFunc: 1, untyped: 0, wrong: 0 }, tables: { total: 0, object: 0, label: 0, wrong: 0 } };
  assertCountsOnly(entry);
  const leaks: readonly unknown[] = [
    { ...entry, placements: { ...entry.placements, firstWrong: 0x0800_0300 } },
    { ...entry, placements: { ...entry.placements, wrongNames: ['m4aSoundInit'] } },
    { ...entry, tables: { ...entry.tables, name: 'gTable' } },
    { ...entry, tables: { ...entry.tables, at: '0x08000300' } },
    { ...entry, rows: [{ addr: 1 }] },
  ];
  for (const leaked of leaks) assert.throws(() => assertCountsOnly(leaked), /sealed field/, JSON.stringify(leaked));
  assert.match(JSON.stringify({ tables: { at: '0x08000300' } }), LEAK);
  assert.match(JSON.stringify({ placements: { addr: 5 } }), LEAK);
  assert.match(JSON.stringify({ tables: { name: 'gTable' } }), LEAK);
});

// ---------------------------------------------------------------------------------------------------
// Leave one reference out.

test('looCounts: added, moved and the shared members the rebuilt version does not place', () => {
  const full = [placement('A@x.o', 0x100), placement('B@x.o', 0x200), placement('C@x.o', 0x300), placement('Own@x.o', 0x400)];
  assert.deepEqual(looCounts(full, full.slice(0, 3), new Set<MemberId>(['A@x.o', 'B@x.o', 'C@x.o'])), { added: 0, moved: 0, missingShared: 0 }, 'only R-own members missing');
  const loo = [placement('A@x.o', 0x100), placement('B@x.o', 0x210), placement('New@y.o', 0x500)];
  assert.deepEqual(looCounts(full, loo, new Set<MemberId>(['A@x.o', 'B@x.o', 'C@x.o'])), { added: 1, moved: 1, missingShared: 1 });
  assert.deepEqual(looCounts([], [], new Set<MemberId>(['A@x.o'])), { added: 0, moved: 0, missingShared: 1 });
});

test('looCounts: a renamed member is its counterpart, and another member at an address the full build placed adds nothing', () => {
  const full = [placement('A@x.o', 0x100), placement('B@x.o', 0x200), placement('C@x.o', 0x300)];
  const shared = new Set<MemberId>(['A@x.o', 'B@x.o']);
  // B is linked by R and another reference, under R's id; without R it carries the other reference's id.
  const loo = [placement('A@x.o', 0x100), placement('B@y.o', 0x200), placement('Same@z.o', 0x300)];
  assert.deepEqual(looCounts(full, loo, shared), { added: 0, moved: 0, missingShared: 1 }, 'without counterparts B is missing');
  assert.deepEqual(looCounts(full, loo, shared, new Map<MemberId, MemberId>([['B@y.o', 'B@x.o']])), { added: 0, moved: 0, missingShared: 0 });
  const movedLoo = [placement('A@x.o', 0x100), placement('B@y.o', 0x240)];
  assert.deepEqual(looCounts(full, movedLoo, shared, new Map<MemberId, MemberId>([['B@y.o', 'B@x.o']])), { added: 0, moved: 1, missingShared: 0 });
});

test("counterparts: the full build's id of the member another reference links at the same address", () => {
  const fullFile = signatureFile('lib', {
    id: '1',
    members: [],
    linkOrder: [
      { reference: 'r1', members: [{ name: 'A', addr: 1 }, { name: 'B', addr: 2 }] },
      { reference: 'r2', members: [{ name: 'A', addr: 5 }, { name: 'C', addr: 6 }] },
    ],
  });
  const rebuiltFile = signatureFile('lib', {
    id: '1',
    members: [],
    linkOrder: [{ reference: 'r2', members: [{ name: 'A', addr: 5, object: 'other' }, { name: 'C', addr: 6 }, { name: 'D', addr: 7 }] }],
  });
  const full = fullFile.versions[0];
  const rebuilt = rebuiltFile.versions[0];
  assert.ok(full !== undefined && rebuilt !== undefined);
  assert.deepEqual([...counterparts(full, rebuilt)].sort(), [['A@other.o', 'A@lib.o'], ['C@lib.o', 'C@lib.o']]);
});

test("sharedMembers is R's link order intersected with the other references' link orders", () => {
  const file = signatureFile('lib', {
    id: '1',
    members: [],
    linkOrder: [
      { reference: 'r1', members: [{ name: 'A', addr: 1 }, { name: 'B', addr: 2 }, { name: 'Own', addr: 3 }] },
      { reference: 'r2', members: [{ name: 'A', addr: 5 }, { name: 'C', addr: 6 }] },
      { reference: 'r3', members: [{ name: 'B', addr: 7 }] },
    ],
  });
  const v = file.versions[0];
  assert.ok(v !== undefined);
  assert.deepEqual([...sharedMembers(v, 'r1')].sort(), ['A@lib.o', 'B@lib.o']);
  assert.deepEqual([...sharedMembers(v, 'r2')], ['A@lib.o']);
  assert.deepEqual([...sharedMembers(v, 'nobody')], []);
});

test('withoutReference, looPairs and replaceLibrary', () => {
  const spec: SignatureSpec = {
    library: 'lib',
    versions: [
      { id: '1', idNote: '', references: [{ dataset: 'a', objects: ['*.o'] }, { dataset: 'b', objects: ['*.o'] }] },
      { id: '2', idNote: '', references: [{ dataset: 'a', objects: ['*.o'] }] },
    ],
    reviewedNames: {},
  };
  assert.deepEqual(looPairs(spec), [{ version: '1', reference: 'a' }, { version: '1', reference: 'b' }]);
  const less = withoutReference(spec, '1', 'a');
  assert.deepEqual(less.versions.map((v) => v.references.map((r) => r.dataset)), [['b'], ['a']]);
  assert.deepEqual(spec.versions[0]?.references.length, 2, 'the spec itself is untouched');
  const a = signatureFile('a', { id: '1', members: [] });
  const b = signatureFile('b', { id: '1', members: [] });
  const b2 = { ...b, builtWith: 'loo' };
  assert.deepEqual(replaceLibrary([a, b], b2), [a, b2]);
});

test('signaturesDigest does not depend on the order of the files', () => {
  const a = signatureFile('a', { id: '1', members: [] });
  const b = signatureFile('b', { id: '1', members: [] });
  assert.equal(signaturesDigest([a, b]), signaturesDigest([b, a]));
  assert.notEqual(signaturesDigest([a]), signaturesDigest([a, b]));
});

// ---------------------------------------------------------------------------------------------------
// End to end on the library fixtures.

const SYNTHETIC = fileURLToPath(new URL('../../../bench/dataset/synthetic/', import.meta.url));
const FIXTURE_SPEC = join(SYNTHETIC, 'library', 'spec.json');

function capture(): BenchIo & { readonly lines: string[]; readonly errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

/** A real tier over the committed library fixtures: the two references, the game ROM tuning and the game ROM sealed. */
async function libraryTier(root: string, options: { readonly build?: boolean } = {}): Promise<BenchContext> {
  const repoRoot = join(root, 'repo');
  const cx: BenchContext = { repoRoot, benchRoot: SYNTHETIC, pocRoot: join(root, 'poc') };
  await mkdir(join(repoRoot, 'bench', 'dataset', 'real'), { recursive: true });
  await mkdir(join(repoRoot, 'signatures', 'specs'), { recursive: true });
  await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ name: 'romlift', version: '1.2.3' }));
  const put = async (name: string, fixture: string, overrides: Record<string, unknown> = {}): Promise<void> => {
    const at = (ext: string): string => `${fixture}/build/${fixture}.${ext}`;
    const sha1 = sha1Of(new Uint8Array(await readFile(join(SYNTHETIC, at('gba')))));
    const elfSha256 = sha256Of(new Uint8Array(await readFile(join(SYNTHETIC, at('elf')))));
    const d = { ...dataset({ name, rom: at('gba'), elf: at('elf'), map: at('map'), sha1, elfSha256 }), ...overrides };
    await writeFile(join(repoRoot, 'bench', 'dataset', 'real', `${name}.json`), JSON.stringify(d));
  };
  await put('library', 'library');
  await put('library-ref2', 'library-ref2');
  await put('game', 'library-game');
  await put('sealedgame', 'library-game', { heldout: true, family: 'other' });
  await writeFile(join(repoRoot, 'signatures', 'specs', 'libfix.json'), await readFile(FIXTURE_SPEC, 'utf8'));
  if (options.build !== false) {
    const built = await buildSignatures({ specPath: join(repoRoot, 'signatures', 'specs', 'libfix.json') }, { benchRoot: SYNTHETIC, builtWith: 'test' });
    assert.ok(built.ok, built.ok ? '' : built.diagnostic.message);
    const written = await writeSignatureFile(join(repoRoot, 'signatures'), built.value);
    assert.ok(written.ok);
  }
  return cx;
}

test('bench signatures refuses a tier with no built file, naming the build loop', async () => {
  await withTempDir('romlift-bench-sig-', async (root) => {
    const cx = await libraryTier(root, { build: false });
    await assert.rejects(readBuiltSignatures(cx), (e: unknown) => e instanceof BenchError && e.message.includes(SIGNATURES_BUILD_LOOP));
    const io = capture();
    assert.equal(await main(['signatures', '--json'], cx, io, { runner: ROMLIFT_RUNNER, now: () => '' }), 1);
    assert.match(io.errors.join('\n'), /no built signature file/);
  });
});

test('bench signatures --json: the references judged with their own symbols, the game ROM judged, the sealed game ROM counted', async () => {
  await withTempDir('romlift-bench-sig-', async (root) => {
    const cx = await libraryTier(root);
    const io = capture();
    assert.equal(await main(['signatures', '--json'], cx, io, { runner: ROMLIFT_RUNNER, now: () => '' }), 0, io.errors.join('\n'));
    const report = JSON.parse(io.lines.at(-1) ?? '') as BenchSignaturesReport;
    assert.equal(report.schema, BENCH_SIGNATURES_SCHEMA);
    assert.deepEqual(report.roms.map((r) => r.name), ['game', 'library', 'library-ref2']);
    for (const rom of report.roms) {
      assert.equal(rom.placements.wrong, 0, `${rom.name}: ${io.lines.join('\n')}`);
      assert.equal(rom.placements.atElfFunc, rom.placements.total, rom.name);
      assert.equal(rom.tables.wrong, 0, rom.name);
      assert.equal(rom.sizes.differ, 0, rom.name);
    }
    const game = report.roms.find((r) => r.name === 'game');
    assert.deepEqual(game?.libraries, [{ library: 'libfix', version: '1.0', functions: 13, objects: 1 }]);
    assert.deepEqual(game?.names, { reference: false, total: 0, equal: 0, differ: 0, reviewed: 1 }, 'Halt is the reviewed name of FixSwiHalt');
    const library = report.roms.find((r) => r.name === 'library');
    assert.equal(library?.names.reference, true);
    assert.equal(library?.names.differ, 0);
    assert.equal(library?.names.equal, library?.names.total);
    assert.ok((library?.names.total ?? 0) > 0);
    assert.deepEqual(report.sealed, [{ name: 'sealedgame', placements: { total: 13, atElfFunc: 13, untyped: 0, wrong: 0 }, tables: { total: 1, object: game?.tables.objectOfSize ?? -1, label: game?.tables.label ?? -1, wrong: 0 } }]);
    // The sealed ROM's lines print counts only.
    const sealedLines = io.lines.filter((l) => l.startsWith('sealedgame'));
    assert.equal(sealedLines.length, 1);
    assert.doesNotMatch(sealedLines[0] ?? '', /0x|Fix|gFix|Halt/);
    const sealed = report.sealed[0];
    assert.ok(sealed !== undefined);
    const { name: _name, ...numbers } = sealed;
    assert.doesNotMatch(JSON.stringify(numbers), LEAK);
  });
});

test('bench signatures --only <sealed> runs that dataset alone and reports its counts only', async () => {
  await withTempDir('romlift-bench-sig-', async (root) => {
    const cx = await libraryTier(root);
    const report = await benchSignatures(cx, { only: 'sealedgame', runner: ROMLIFT_RUNNER });
    assert.deepEqual(report.roms, []);
    assert.deepEqual(report.sealed.map((s) => s.name), ['sealedgame']);
    await assert.rejects(benchSignatures(cx, { only: 'nosuch', runner: ROMLIFT_RUNNER }), /no dataset named nosuch/);
  });
});

test('bench signatures --loo: every reference of the two-reference version left out once, its counts on its own ROM', async () => {
  await withTempDir('romlift-bench-sig-', async (root) => {
    const cx = await libraryTier(root);
    const io = capture();
    assert.equal(await main(['signatures', '--loo', '--json'], cx, io, { runner: ROMLIFT_RUNNER, now: () => '' }), 0, io.errors.join('\n'));
    const report = JSON.parse(io.lines.at(-1) ?? '') as BenchSignaturesLooReport;
    assert.equal(report.schema, BENCH_SIGNATURES_LOO_SCHEMA);
    assert.deepEqual(
      report.runs.map((r) => [r.library, r.version, r.reference]),
      [
        ['libfix', '1.0', 'library'],
        ['libfix', '1.0', 'library-ref2'],
      ],
    );
    // The fixture's two references link the same objects in different orders: leaving either out changes nothing they share.
    for (const r of report.runs) assert.deepEqual({ added: r.added, moved: r.moved, missingShared: r.missingShared }, { added: 0, moved: 0, missingShared: 0 }, r.reference);
    assert.deepEqual(io.lines.slice(0, 2), ['libfix@1.0 without library: 0 added, 0 moved, 0 shared members not placed', 'libfix@1.0 without library-ref2: 0 added, 0 moved, 0 shared members not placed']);
    const only = await benchSignaturesLoo(cx, { only: 'library-ref2', runner: ROMLIFT_RUNNER });
    assert.deepEqual(only.runs.map((r) => r.reference), ['library-ref2']);
  });
});
