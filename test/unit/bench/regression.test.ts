import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Dataset } from '../../../bench/src/dataset.ts';
import { parseTrailers, regressionFailures, type RegressionInput } from '../../../bench/src/regression.ts';
import type { BenchRow } from '../../../bench/src/row.ts';
import { dataset, results, row } from './fixtures.ts';

const MISMATCH = { addr: '0x08000300', name: 'big', elf: 64, found: 48 };
const BASE_ROW = row({ extents: { sized: 10, agree: 9, mismatches: [MISMATCH] } });

function failures(fresh: BenchRow, overrides: Partial<RegressionInput> = {}): string[] {
  return regressionFailures({
    fresh: results([fresh]),
    base: results([BASE_ROW]),
    datasets: [dataset()],
    baseDatasets: new Map([['tiny', dataset()]]),
    trailers: [],
    ...overrides,
  });
}

test('an unchanged artifact has no regression', () => {
  assert.deepEqual(failures(BASE_ROW), []);
});

test('fewer true positives fail', () => {
  assert.deepEqual(failures({ ...BASE_ROW, tp: 9 }), ['tiny: true positives fell from 10 to 9']);
});

test('a new extent mismatch fails; one the base already had does not', () => {
  const extra = { addr: '0x08000400', name: 'f', elf: 8, found: 4 };
  assert.deepEqual(failures({ ...BASE_ROW, extents: { sized: 10, agree: 8, mismatches: [MISMATCH, extra] } }), ['tiny: new extent mismatch at 0x08000400 f: found 4, ELF 8']);
});

test('an unlisted miss or false entry fails; a listed one does not', () => {
  const misses = [
    { addr: '0x08000500', name: 'm', size: 4, reason: 'inside-code' as const, listed: false },
    { addr: '0x08000600', name: 'n', size: 4, reason: 'inside-code' as const, listed: true, category: 'loop-label' as const },
  ];
  const falseEntries = [{ addr: '0x08000700', origin: 'gap-scan' as const, size: 8, owner: 'host', listed: false }];
  assert.deepEqual(failures({ ...BASE_ROW, misses, falseEntries }), [
    'tiny: miss 0x08000500 m (inside-code) is not in the labels list',
    'tiny: false entry 0x08000700 via gap-scan, 8 bytes inside host is not in the untyped list',
  ]);
});

test('a code end beyond 16 bytes and a non-deterministic run fail', () => {
  assert.deepEqual(failures({ ...BASE_ROW, codeEnd: { found: '0x08001011', elf: '0x08001000', delta: 17 } }), ["tiny: code end 0x08001011 is 17 bytes from the ELF's 0x08001000"]);
  assert.deepEqual(failures({ ...BASE_ROW, codeEnd: { found: '0x08000FF0', elf: '0x08001000', delta: -16 } }), []);
  assert.deepEqual(failures({ ...BASE_ROW, deterministic: false }), ['tiny: two runs disagree']);
});

test('a ROM the fresh artifact lost fails', () => {
  assert.deepEqual(failures(BASE_ROW, { base: results([BASE_ROW, row({ name: 'gone' })]) }), ['gone: in the base artifact but not in the fresh one (coverage shrank)']);
});

test('a dataset row added without a Bench-Exception trailer fails; with one it passes', () => {
  const grown: Dataset = dataset({ untyped: [{ addr: '0x08000700', category: 'veneer', note: 'n' }] });
  const added = failures(BASE_ROW, { datasets: [grown] });
  assert.deepEqual(added, ["tiny: untyped row 0x08000700 was added without a 'Bench-Exception: tiny 0x08000700 <reason>' trailer"]);
  assert.deepEqual(failures(BASE_ROW, { datasets: [grown], trailers: [{ rom: 'tiny', addr: '0x08000700', reason: 'a linker veneer' }] }), []);
  assert.deepEqual(failures(BASE_ROW, { datasets: [grown], trailers: [{ rom: 'other', addr: '0x08000700', reason: 'x' }] }), added);
  // A file base has no datasets to compare with.
  assert.deepEqual(failures(BASE_ROW, { datasets: [grown], baseDatasets: undefined }), []);
});

test('trailers are parsed from commit messages', () => {
  const messages = ['Add a row\n\nBench-Exception: sa2 0x080945EC inside umul3232H32, a mixer helper\nCo-Authored-By: x', 'Bench-Exception: bad 0x8000 short', 'no trailer'];
  assert.deepEqual(parseTrailers(messages), [{ rom: 'sa2', addr: '0x080945EC', reason: 'inside umul3232H32, a mixer helper' }]);
});
