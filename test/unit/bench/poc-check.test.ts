import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jsonDiffs, stripSeconds, withoutPaths } from '../../../bench/src/baseline.ts';
import { checkPocRom, romPasses } from '../../../bench/src/poc-check.ts';
import { dump, row } from './fixtures.ts';

const ROW = row();
/** The baseline row: the PoC's fields, including those poc-check does not compare. */
const BASELINE = { ...ROW, scaffold: { ok: true, summary: 'built' }, signatures: { functions: 94 }, datasetProblems: [] };
const DUMP = dump({ pocRow: { ...BASELINE, signatures: { functions: 94, seconds: 0.1 } } });
const PINNED = DUMP.pocSourceDigest;

test('a rescored row equal to the baseline passes every check', () => {
  const r = checkPocRom('tiny', ROW, DUMP, BASELINE, PINNED);
  assert.deepEqual(r, { name: 'tiny', rowsEqual: true, pocRowEqual: true, diffs: [], scaffoldOk: true, deterministic: true, pocSourceDigestOk: true });
  assert.ok(romPasses(r));
});

test('a field that differs fails the rows comparison and names the field', () => {
  const r = checkPocRom('tiny', { ...ROW, tp: 9 }, DUMP, BASELINE, PINNED);
  assert.equal(r.rowsEqual, false);
  assert.deepEqual(r.diffs, ['row tp: expected 10, got 9']);
  const moved = checkPocRom('tiny', { ...ROW, misses: [{ addr: '0x08000400', name: 'x', size: 4, reason: 'inside-code', listed: false }] }, DUMP, BASELINE, PINNED);
  assert.ok(moved.diffs.includes('row misses: expected 0 items, got 1'));
  assert.ok(!romPasses(moved));
});

test('the excluded fields never fail the comparison', () => {
  const r = checkPocRom('tiny', ROW, DUMP, { ...BASELINE, signatures: { functions: 1 }, datasetProblems: ['x'], scaffold: { ok: true, summary: 'other' } }, PINNED);
  assert.equal(r.rowsEqual, true);
  // The PoC's own row is compared on its scaffold summary and dataset problems too.
  assert.equal(r.pocRowEqual, false);
  assert.ok(r.diffs.some((d) => d.startsWith('pocRow datasetProblems')));
});

test('a PoC row that differs, a failed scaffold, two digests and another PoC source each fail', () => {
  assert.equal(checkPocRom('tiny', ROW, { ...DUMP, pocRow: { ...DUMP.pocRow, elfCommit: 'zzz' } }, BASELINE, PINNED).pocRowEqual, false);
  assert.equal(checkPocRom('tiny', ROW, { ...DUMP, scaffold: { ok: false, summary: '' } }, BASELINE, PINNED).scaffoldOk, false);
  assert.equal(checkPocRom('tiny', ROW, { ...DUMP, digests: ['a', 'b'] }, BASELINE, PINNED).deterministic, false);
  // Two equal digests are not enough: they must be the digest of the analysis the dump stores.
  const edited = { ...DUMP.analysis, codeRange: ['0x08000000', '0x08000004'] as const };
  assert.equal(checkPocRom('tiny', ROW, { ...DUMP, analysis: edited }, BASELINE, PINNED).deterministic, false);
  assert.equal(checkPocRom('tiny', ROW, DUMP, BASELINE, 'q'.repeat(64)).pocSourceDigestOk, false);
  const none = checkPocRom('tiny', ROW, DUMP, undefined, PINNED);
  assert.deepEqual(none.diffs, ['no baseline row for tiny']);
  assert.ok(!romPasses(none));
});

test('stripSeconds drops every seconds key at any depth, so two dumps of one run are byte-equal', () => {
  assert.deepEqual(stripSeconds({ seconds: 1, scaffold: { ok: true, seconds: 2, summary: 's' }, signatures: { seconds: 3, versions: [{ seconds: 4, library: 'm4a' }] } }), {
    scaffold: { ok: true, summary: 's' },
    signatures: { versions: [{ library: 'm4a' }] },
  });
});

test('withoutPaths and jsonDiffs', () => {
  assert.deepEqual(withoutPaths({ a: 1, b: { c: 2, d: 3 }, e: 4 }, ['e', 'b.c']), { a: 1, b: { d: 3 } });
  assert.deepEqual(jsonDiffs({ a: [1, 2], b: { c: 'x' } }, { a: [1, 3], b: { c: 'x' } }), ['a[1]: expected 2, got 3']);
  assert.deepEqual(jsonDiffs({ a: 1 }, { b: 1 }), ['a: expected 1, got absent', 'b: expected absent, got 1']);
  assert.deepEqual(jsonDiffs({ a: null }, { a: null }), []);
  assert.equal(jsonDiffs({ a: Array.from({ length: 50 }, (_, i) => i) }, { a: [] }, '', 5).length, 5);
});
