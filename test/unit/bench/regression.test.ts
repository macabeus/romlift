import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Dataset } from '../../../bench/src/dataset.ts';
import {
  type RegressionInput,
  parseTrailers,
  readabilityProblems,
  regressionFailures,
  regressionProblems,
  regressionReport,
} from '../../../bench/src/regression.ts';
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
  assert.deepEqual(failures({ ...BASE_ROW, extents: { sized: 10, agree: 8, mismatches: [MISMATCH, extra] } }), [
    'tiny: new extent mismatch at 0x08000400 f: found 4, ELF 8',
  ]);
});

test('an unlisted miss or false entry fails; a listed one does not', () => {
  const misses = [
    { addr: '0x08000500', name: 'm', size: 4, reason: 'inside-code' as const, listed: false },
    {
      addr: '0x08000600',
      name: 'n',
      size: 4,
      reason: 'inside-code' as const,
      listed: true,
      category: 'loop-label' as const,
    },
  ];
  const falseEntries = [{ addr: '0x08000700', origin: 'gap-scan' as const, size: 8, owner: 'host', listed: false }];
  assert.deepEqual(failures({ ...BASE_ROW, misses, falseEntries }), [
    'tiny: miss 0x08000500 m (inside-code) is not in the labels list',
    'tiny: false entry 0x08000700 via gap-scan, 8 bytes inside host is not in the untyped list',
  ]);
});

test('a code end beyond 16 bytes and a non-deterministic run fail', () => {
  assert.deepEqual(failures({ ...BASE_ROW, codeEnd: { found: '0x08001011', elf: '0x08001000', delta: 17 } }), [
    "tiny: code end 0x08001011 is 17 bytes from the ELF's 0x08001000",
  ]);
  assert.deepEqual(failures({ ...BASE_ROW, codeEnd: { found: '0x08000FF0', elf: '0x08001000', delta: -16 } }), []);
  assert.deepEqual(failures({ ...BASE_ROW, deterministic: false }), ['tiny: two runs disagree']);
});

test('a ROM the fresh artifact lost fails', () => {
  assert.deepEqual(failures(BASE_ROW, { base: results([BASE_ROW, row({ name: 'gone' })]) }), [
    'gone: in the base artifact but not in the fresh one (coverage shrank)',
  ]);
});

test('a dataset row added without a Bench-Exception trailer fails; with one it passes', () => {
  const grown: Dataset = dataset({ untyped: [{ addr: '0x08000700', category: 'veneer', note: 'n' }] });
  const added = failures(BASE_ROW, { datasets: [grown] });
  assert.deepEqual(added, [
    "tiny: untyped row 0x08000700 was added without a 'Bench-Exception: tiny 0x08000700 <reason>' trailer",
  ]);
  assert.deepEqual(
    failures(BASE_ROW, {
      datasets: [grown],
      trailers: [{ rom: 'tiny', addr: '0x08000700', reason: 'a linker veneer' }],
    }),
    [],
  );
  assert.deepEqual(
    failures(BASE_ROW, { datasets: [grown], trailers: [{ rom: 'other', addr: '0x08000700', reason: 'x' }] }),
    added,
  );
  // A file base has no datasets to compare with.
  assert.deepEqual(failures(BASE_ROW, { datasets: [grown], baseDatasets: undefined }), []);
});

test('trailers are parsed from commit messages', () => {
  const messages = [
    'Add a row\n\nBench-Exception: sa2 0x080945EC inside umul3232H32, a mixer helper\nCo-Authored-By: x',
    'Bench-Exception: bad 0x8000 short',
    'no trailer',
  ];
  assert.deepEqual(parseTrailers(messages), [
    { rom: 'sa2', addr: '0x080945EC', reason: 'inside umul3232H32, a mixer helper' },
  ]);
});

const ROMLIFT = { ...results([BASE_ROW]).meta, source: 'romlift' as const };

test('every problem has a kind; the text form is <rom>: <detail>', () => {
  const problems = regressionProblems({
    fresh: results([{ ...BASE_ROW, tp: 9, deterministic: false }]),
    base: results([BASE_ROW]),
    datasets: [dataset()],
    baseDatasets: undefined,
    trailers: [],
  });
  assert.deepEqual(problems, [
    { kind: 'nondeterministic', rom: 'tiny', detail: 'two runs disagree' },
    { kind: 'true-positives', rom: 'tiny', detail: 'true positives fell from 10 to 9' },
  ]);
});

test('a PoC-sourced base against romlift rows: fixed fields must be equal and the rows may only improve', () => {
  const miss = {
    addr: '0x08000500',
    name: 'm',
    size: 4,
    reason: 'inside-code' as const,
    listed: true,
    category: 'loop-label' as const,
  };
  const falseEntry = {
    addr: '0x08000700',
    origin: 'gap-scan' as const,
    size: 8,
    listed: true,
    category: 'veneer' as const,
  };
  const pocRow = { ...BASE_ROW, misses: [miss], falseEntries: [falseEntry] };
  const input = (fresh: BenchRow): RegressionInput => ({
    fresh: { ...results([fresh]), meta: ROMLIFT },
    base: results([pocRow]),
    datasets: [dataset()],
    baseDatasets: undefined,
    trailers: [],
  });
  // Equal rows and pure improvements pass.
  assert.deepEqual(regressionProblems(input(pocRow)), []);
  assert.deepEqual(
    regressionProblems(
      input({ ...pocRow, misses: [], falseEntries: [], extents: { sized: 10, agree: 10, mismatches: [] } }),
    ),
    [],
  );
  // A changed reason, a changed false entry, a changed extent and a moved startup are each named.
  const moved = regressionProblems(
    input({
      ...pocRow,
      startup: { ...pocRow.startup, end: '0x08000104' },
      misses: [{ ...miss, reason: 'unanchored' }],
      falseEntries: [{ ...falseEntry, size: 6 }],
      extents: { sized: 10, agree: 9, mismatches: [{ ...MISMATCH, found: 40 }] },
    }),
  );
  assert.deepEqual(
    moved.map((p) => p.kind),
    ['row-field', 'extent-changed', 'miss-changed', 'false-entry-changed'],
  );
  assert.match(moved[0]?.detail ?? '', /^startup is .*0x08000104.*, the PoC row has .*0x08000100/);
  // A PoC base against PoC rows is not compared field by field.
  assert.deepEqual(
    regressionProblems({
      ...input({ ...pocRow, misses: [{ ...miss, reason: 'unanchored' }] }),
      fresh: results([{ ...pocRow, misses: [{ ...miss, reason: 'unanchored' }] }]),
    }),
    [],
  );
});

test('the --json report: ok only without problems, the base named', () => {
  const outcome = {
    baseLabel: 'abc',
    notes: [],
    failures: ['tiny: x'],
    problems: [{ kind: 'k', rom: 'tiny', detail: 'x' }],
  };
  assert.deepEqual(regressionReport(outcome), {
    schema: 'romlift/bench-regression@1',
    ok: false,
    base: 'abc',
    problems: [{ kind: 'k', rom: 'tiny', detail: 'x' }],
  });
  assert.equal(regressionReport({ ...outcome, failures: [], problems: [] }).ok, true);
});

const SHARES = { mnemonicShare: 0.99, symbolicBranchShare: 1, symbolicPoolShare: 0.98 };

test('a lower readability share fails; an equal or higher one does not; a base without the family is skipped', () => {
  const base = { ...BASE_ROW, readability: { ...SHARES, floor: null } };
  const withShares = (s: Partial<typeof SHARES>): BenchRow => ({
    ...BASE_ROW,
    readability: { ...SHARES, ...s, floor: null },
  });
  const run = (fresh: BenchRow, b: BenchRow = base): string[] => failures(fresh, { base: results([b]) });
  assert.deepEqual(run(withShares({})), []);
  assert.deepEqual(run(withShares({ mnemonicShare: 1, symbolicPoolShare: 0.99 })), []);
  assert.deepEqual(run(withShares({ symbolicPoolShare: 0.97 })), ['tiny: symbolicPoolShare fell from 0.98 to 0.97']);
  assert.deepEqual(run(BASE_ROW), ['tiny: the base measured the readability shares, the fresh artifact does not']);
  // A phase-2 base (no readability member) is never compared.
  assert.deepEqual(run(withShares({ mnemonicShare: 0 }), BASE_ROW), []);
  assert.deepEqual(
    readabilityProblems(withShares({ mnemonicShare: 0.5 }), base).map((p) => p.kind),
    ['readability'],
  );
});
