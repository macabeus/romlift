import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseElf } from 'romlift';

import type { MissDiagnosis } from 'romlift/internal';

import { missQueries } from '../../../bench/src/analysis-run.ts';
import { dumpFunctions, extentAgrees, insideFoundFunction, scoreAnalysis, scoreRun, staleExceptions } from '../../../bench/src/score.ts';
import { elfTruth } from '../../../bench/src/truth.ts';
import { analysisResult, dataset, dump, elfFile, fact, fn } from './fixtures.ts';

// Table order matters: `big` precedes `outer`, which also contains 0x08000310.
const ELF = elfFile([
  { name: 'crt0', value: 0x0800_0000, size: 0xc0 },
  { name: 'main', value: 0x0800_0201, size: 0x20 },
  { name: 'big', value: 0x0800_0301, size: 0x40 },
  { name: 'outer', value: 0x0800_0281, size: 0x100 },
  { name: 'main_alias', value: 0x0800_0201, size: 0x24 },
  { name: 'missed', value: 0x0800_0401, size: 0x10 },
  { name: 'label', value: 0x0800_0501, size: 0 },
  { name: 'iwram_fn', value: 0x0300_0001, size: 8 },
  { name: 'table', value: 0x0800_0600, size: 16, type: 'object' },
]);
const ROM_SIZE = 0x1000;

const DUMP = dump({
  analysis: {
    functions: [
      fn('0x08000000', '0x080000B0', 'rom entry', 'arm'),
      fn('0x080000C0', '0x08000100', 'adr', 'arm'),
      fn('0x08000200', '0x08000222', 'call'),
      fn('0x08000280', '0x08000380', 'pool pointer'),
      fn('0x08000300', '0x08000330', 'call'),
      fn('0x08000310', '0x08000318', 'gap scan'),
      fn('0x08000700', '0x08000710', 'data pointer', 'arm'),
    ],
    startup: { end: '0x08000100', entries: ['0x08000000', '0x080000C0'] },
    codeRange: ['0x08000000', '0x08000710'],
  },
  misses: [
    { addr: '0x08000400', reason: 'inside code of the accepted function at 08000380' },
    { addr: '0x08000500', reason: 'valid but not accepted: not anchored at start, no push {.., lr}' },
  ],
});

const DATASET = dataset({
  labels: [{ addr: '0x08000500', name: 'label', category: 'loop-label', note: 'n' }],
  untyped: [{ addr: '0x08000310', category: 'mixer-internal', note: 'n' }],
});

test('the truth keeps ROM FUNC symbols, the first name, the largest size and the table order', () => {
  const truth = elfTruth(ELF, ROM_SIZE);
  assert.deepEqual(
    truth.functions.map((t) => [t.name, t.addr, t.size]),
    [
      ['crt0', 0x0800_0000, 0xc0],
      ['main', 0x0800_0200, 0x24],
      ['big', 0x0800_0300, 0x40],
      ['outer', 0x0800_0280, 0x100],
      ['missed', 0x0800_0400, 0x10],
      ['label', 0x0800_0500, 0],
    ],
  );
  assert.equal(truth.byAddr.get(0x0800_0200)?.thumb, true);
  assert.equal(truth.byAddr.get(0x0800_0000)?.thumb, false);
  // A ROM that ends before a function leaves it out.
  assert.equal(elfTruth(ELF, 0x400).functions.length, 4);
});

test('the truth of the committed tiny.elf fixture', () => {
  const parsed = parseElf(new Uint8Array(readFileSync(new URL('../../fixtures/formats/tiny.elf', import.meta.url))));
  assert.ok(parsed.ok);
  const truth = elfTruth(parsed.value, 0x30);
  assert.deepEqual(
    truth.functions.map((t) => [t.name, t.addr, t.size, t.thumb]),
    [
      ['thumb_two', 0x0800_000e, 10, true],
      ['lib_helper', 0x0800_0018, 4, true],
      ['arm_entry', 0x0800_0000, 8, false],
      ['thumb_one', 0x0800_0008, 6, true],
    ],
  );
});

test('extents agree exactly or with the 4-byte padding allowance', () => {
  assert.ok(extentAgrees(0x24, 0x24));
  assert.ok(extentAgrees(0x24, 0x22));
  assert.ok(extentAgrees(0x24, 0x21));
  assert.ok(!extentAgrees(0x24, 0x20));
  assert.ok(!extentAgrees(0x22, 0x24));
});

test('scoreRun counts from the startup end and classifies every miss and false entry', () => {
  const row = scoreRun({ dump: DUMP, truth: elfTruth(ELF, ROM_SIZE), dataset: DATASET, sha1: 'f'.repeat(40) });
  assert.equal(row.name, 'tiny');
  assert.equal(row.sha1, 'f'.repeat(40));
  assert.equal(row.elfCommit, 'abc1234');
  assert.equal(row.elfFunctions, 5);
  assert.equal(row.entries, 5);
  assert.deepEqual(row.startup, { end: '0x08000100', pieces: 2, elfFunctions: 1 });
  assert.equal(row.thumb, 4);
  assert.equal(row.arm, 1);
  assert.equal(row.tp, 3);
  assert.equal(row.precision, 3 / 5);
  assert.equal(row.recall, 3 / 5);
  assert.deepEqual(row.misses, [
    { addr: '0x08000400', name: 'missed', size: 0x10, reason: 'inside-code', listed: false },
    { addr: '0x08000500', name: 'label', size: 0, reason: 'unanchored', listed: true, category: 'loop-label' },
  ]);
  assert.deepEqual(row.falseEntries, [
    { addr: '0x08000310', origin: 'gap-scan', size: 8, owner: 'big', listed: true, category: 'mixer-internal' },
    { addr: '0x08000700', origin: 'data-pointer', size: 0x10, listed: false },
  ]);
  assert.deepEqual(row.extents, {
    sized: 3,
    agree: 2,
    mismatches: [
      { addr: '0x08000000', name: 'crt0', elf: 0xc0, found: 0xb0 },
      { addr: '0x08000300', name: 'big', elf: 0x40, found: 0x30 },
    ],
  });
  assert.deepEqual(row.codeEnd, { found: '0x08000710', elf: '0x08000500', delta: 0x210 });
  assert.equal(row.deterministic, true);
  assert.deepEqual(row.scaffold, { ok: true });
});

test('scoreRun reports two different digests as non-deterministic and carries the scaffold verdict', () => {
  const row = scoreRun({ dump: { ...DUMP, digests: ['a', 'b'], scaffold: { ok: false, summary: 'make failed' } }, truth: elfTruth(ELF, ROM_SIZE), dataset: DATASET, sha1: '' });
  assert.equal(row.deterministic, false);
  assert.deepEqual(row.scaffold, { ok: false });
});

test('scoreRun refuses a dump without a diagnosis for a miss or with an unknown origin', () => {
  const truth = elfTruth(ELF, ROM_SIZE);
  assert.throws(() => scoreRun({ dump: { ...DUMP, misses: DUMP.misses.slice(1) }, truth, dataset: DATASET, sha1: '' }), /no miss diagnosis for 0x08000400 missed/);
  const odd = { ...DUMP, analysis: { ...DUMP.analysis, functions: [...DUMP.analysis.functions, fn('0x08000800', '0x08000804', 'magic')] } };
  assert.throws(() => scoreRun({ dump: odd, truth, dataset: DATASET, sha1: '' }), /unknown PoC origin 'magic'/);
});

test('insideFoundFunction: strictly inside a found extent and not itself an entry', () => {
  const found = dumpFunctions(DUMP, 'tiny');
  assert.ok(insideFoundFunction(found, 0x0800_0204));
  assert.ok(!insideFoundFunction(found, 0x0800_0200));
  assert.ok(!insideFoundFunction(found, 0x0800_0310));
  assert.ok(!insideFoundFunction(found, 0x0800_0222));
  assert.ok(!insideFoundFunction(found, 0x0800_0900));
});

// The same run as DUMP, as romlift's own AnalysisResult with its miss diagnoses.
const RESULT = analysisResult(
  [
    fact(0x0800_0000, 0x0800_00b0, 'rom-entry', 'arm'),
    fact(0x0800_00c0, 0x0800_0100, 'adr', 'arm'),
    fact(0x0800_0200, 0x0800_0222),
    fact(0x0800_0280, 0x0800_0380, 'pool-pointer'),
    fact(0x0800_0300, 0x0800_0330),
    fact(0x0800_0310, 0x0800_0318, 'gap-scan'),
    fact(0x0800_0700, 0x0800_0710, 'data-pointer', 'arm'),
  ],
  { end: 0x0800_0100, entries: [0x0800_0000, 0x0800_00c0] },
  0x0800_0710,
);
const DIAGNOSES: readonly MissDiagnosis[] = [
  { addr: 0x0800_0400, mode: 'thumb', reason: 'inside-code', claim: 1, owner: 0x0800_0380, detail: 'inside code' },
  { addr: 0x0800_0500, mode: 'thumb', reason: 'unanchored', detail: 'valid but not accepted' },
];

test("scoreAnalysis scores romlift's result exactly as scoreRun scores the same PoC run", () => {
  const truth = elfTruth(ELF, ROM_SIZE);
  const row = scoreAnalysis({ result: RESULT, diagnoses: DIAGNOSES, truth, dataset: DATASET, sha1: 'f'.repeat(40), deterministic: true, scaffold: { ok: true } });
  // Equal but for the ELF code end: romlift's rows end the unsized last function ('label', 0x08000500) at
  // the next code-ending symbol (truth.ts elfCodeEnd, D60 j, the owner's answer to Q5, D61 a), the PoC's
  // rescoring where it starts (pocCodeEnd), as the PoC's pinned rows do.
  const poc = scoreRun({ dump: DUMP, truth, dataset: DATASET, sha1: 'f'.repeat(40) });
  assert.deepEqual({ ...row, codeEnd: poc.codeEnd }, poc);
  assert.deepEqual(poc.codeEnd, { found: '0x08000710', elf: '0x08000500', delta: 0x210 });
  // 'label' has no size; the next code-ending symbol after it is the OBJECT 'table' at 0x08000600.
  assert.deepEqual(row.codeEnd, { found: '0x08000710', elf: '0x08000600', delta: 0x110 });
  // Counted from the startup end; the owner of a false entry is the first containing ELF function in table order.
  assert.equal(row.entries, 5);
  assert.equal(row.tp, 3);
  assert.equal(row.falseEntries[0]?.owner, 'big');
  assert.deepEqual(row.misses.map((m) => [m.addr, m.reason]), [['0x08000400', 'inside-code'], ['0x08000500', 'unanchored']]);
  // Without a dump the row has no scaffold verdict; a second run that differs is recorded.
  const bare = scoreAnalysis({ result: RESULT, diagnoses: DIAGNOSES, truth, dataset: DATASET, sha1: '', deterministic: false });
  assert.equal(bare.scaffold, undefined);
  assert.ok(!('scaffold' in bare));
  assert.equal(bare.deterministic, false);
});

test('scoreAnalysis refuses a miss without a diagnosis', () => {
  assert.throws(() => scoreAnalysis({ result: RESULT, diagnoses: DIAGNOSES.slice(1), truth: elfTruth(ELF, ROM_SIZE), dataset: DATASET, sha1: '', deterministic: true }), /no miss diagnosis for 0x08000400 missed/);
});

test('missQueries asks about the ELF functions from the startup end the run did not report, with their modes', () => {
  assert.deepEqual(missQueries(RESULT, elfTruth(ELF, ROM_SIZE)), [
    { addr: 0x0800_0400, mode: 'thumb' },
    { addr: 0x0800_0500, mode: 'thumb' },
  ]);
});

test('staleExceptions lists the labels the run no longer misses and the untyped rows it no longer reports', () => {
  const truth = elfTruth(ELF, ROM_SIZE);
  const row = scoreAnalysis({ result: RESULT, diagnoses: DIAGNOSES, truth, dataset: DATASET, sha1: '', deterministic: true });
  assert.deepEqual(staleExceptions(DATASET, row), []);
  const grown = dataset({
    labels: [...DATASET.labels, { addr: '0x08000200', name: 'main', category: 'loop-label', note: 'n' }],
    untyped: [...DATASET.untyped, { addr: '0x08000318', category: 'veneer', note: 'n' }],
  });
  assert.deepEqual(staleExceptions(grown, row), [
    { list: 'labels', addr: '0x08000200' },
    { list: 'untyped', addr: '0x08000318' },
  ]);
});
