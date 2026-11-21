import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jsonDiffs, stripSeconds, withoutPaths } from '../../../bench/src/baseline.ts';
import { asScored, checkPocRom, romPasses, withoutCategories } from '../../../bench/src/poc-check.ts';
import { dump, row } from './fixtures.ts';

const ROW = row();
/** The baseline row: the PoC's fields, including those poc-check does not compare. */
const BASELINE = {
  ...ROW,
  scaffold: { ok: true, summary: 'built' },
  signatures: { functions: 94 },
  datasetProblems: [],
};
const DUMP = dump({ pocRow: { ...BASELINE, signatures: { functions: 94, seconds: 0.1 } } });
const PINNED = DUMP.pocSourceDigest;
/** The fixture's ELF code end, the same under both conventions. */
const RULERS = { elf: 0x0800_1000, poc: 0x0800_1000 };

test('a rescored row equal to the baseline passes every check', () => {
  const r = checkPocRom('tiny', ROW, DUMP, BASELINE, PINNED, RULERS);
  assert.deepEqual(r, {
    name: 'tiny',
    rowsEqual: true,
    pocRowEqual: true,
    baselineRow: true,
    diffs: [],
    scaffoldOk: true,
    deterministic: true,
    pocSourceDigestOk: true,
  });
  assert.ok(romPasses(r));
});

test('a field that differs fails the rows comparison and names the field', () => {
  const r = checkPocRom('tiny', { ...ROW, tp: 9 }, DUMP, BASELINE, PINNED, RULERS);
  assert.equal(r.rowsEqual, false);
  assert.deepEqual(r.diffs, ['row tp: expected 10, got 9']);
  const moved = checkPocRom(
    'tiny',
    { ...ROW, misses: [{ addr: '0x08000400', name: 'x', size: 4, reason: 'inside-code', listed: false }] },
    DUMP,
    BASELINE,
    PINNED,
    RULERS,
  );
  assert.ok(moved.diffs.includes('row misses: expected 0 items, got 1'));
  assert.ok(!romPasses(moved));
});

test('the excluded fields never fail the comparison', () => {
  const r = checkPocRom(
    'tiny',
    ROW,
    DUMP,
    { ...BASELINE, signatures: { functions: 1 }, datasetProblems: ['x'], scaffold: { ok: true, summary: 'other' } },
    PINNED,
    RULERS,
  );
  assert.equal(r.rowsEqual, true);
  // The PoC's own row is compared on its scaffold summary and dataset problems too.
  assert.equal(r.pocRowEqual, false);
  assert.ok(r.diffs.some((d) => d.startsWith('pocRow datasetProblems')));
});

test('a PoC row that differs, a failed scaffold, two digests and another PoC source each fail', () => {
  assert.equal(
    checkPocRom('tiny', ROW, { ...DUMP, pocRow: { ...DUMP.pocRow, elfCommit: 'zzz' } }, BASELINE, PINNED, RULERS)
      .pocRowEqual,
    false,
  );
  assert.equal(
    checkPocRom('tiny', ROW, { ...DUMP, scaffold: { ok: false, summary: '' } }, BASELINE, PINNED, RULERS).scaffoldOk,
    false,
  );
  assert.equal(
    checkPocRom('tiny', ROW, { ...DUMP, digests: ['a', 'b'] }, BASELINE, PINNED, RULERS).deterministic,
    false,
  );
  // Two equal digests are not enough: they must be the digest of the analysis the dump stores.
  const edited = { ...DUMP.analysis, codeRange: ['0x08000000', '0x08000004'] as const };
  assert.equal(checkPocRom('tiny', ROW, { ...DUMP, analysis: edited }, BASELINE, PINNED, RULERS).deterministic, false);
  assert.equal(checkPocRom('tiny', ROW, DUMP, BASELINE, 'q'.repeat(64), RULERS).pocSourceDigestOk, false);
  const none = checkPocRom('tiny', ROW, DUMP, undefined, PINNED, RULERS);
  assert.deepEqual(none.diffs, ['no baseline row for tiny, and it was not revealed after the baseline was pinned']);
  assert.ok(!romPasses(none));
});

test("a revealed ROM without a baseline row is compared with the PoC's own row (D60), and that row with the pinned one", () => {
  // The dump's own PoC row of the ROM stands in for the baseline row it has none of.
  const dump = { ...DUMP, pocRow: { ...BASELINE } };
  const r = checkPocRom('tiny', ROW, dump, undefined, PINNED, RULERS, { pinnedMismatch: undefined });
  assert.deepEqual(r, {
    name: 'tiny',
    rowsEqual: true,
    pocRowEqual: true,
    baselineRow: false,
    pinnedRow: true,
    diffs: [],
    scaffoldOk: true,
    deterministic: true,
    pocSourceDigestOk: true,
  });
  assert.ok(romPasses(r));
  const differs = checkPocRom('tiny', { ...ROW, tp: 9 }, dump, undefined, PINNED, RULERS, {
    pinnedMismatch: undefined,
  });
  assert.equal(differs.rowsEqual, false);
  assert.match(differs.diffs[0] ?? '', /^row \(against the PoC's own row\) tp:/);
  assert.ok(!romPasses(differs));
  assert.ok(
    !romPasses(
      checkPocRom('tiny', ROW, { ...dump, scaffold: { ok: false, summary: '' } }, undefined, PINNED, RULERS, {
        pinnedMismatch: undefined,
      }),
    ),
    'its scaffold still decides',
  );
  // A PoC row that is not the pinned one (or no pinned row at all) fails: the reference cannot drift unseen.
  const drifted = checkPocRom('tiny', ROW, dump, undefined, PINNED, RULERS, {
    pinnedMismatch: 'the row digest differs',
  });
  assert.equal(drifted.pocRowEqual, false);
  assert.deepEqual(drifted.diffs, ['pocRow the row digest differs']);
  assert.ok(!romPasses(drifted));
  assert.ok(
    !romPasses(checkPocRom('tiny', ROW, dump, undefined, PINNED, RULERS, { pinnedMismatch: 'no pinned PoC row' })),
    'no pinned row',
  );
});

test("the code end (D61 a, in every scorer): the rescored row under `$d` is compared with the PoC's row as the scorer measures it, and the PoC's row must carry the PoC's convention", () => {
  // On this ELF the PoC's convention ends the code 8 bytes before `$d` does (fe7j's case): the PoC's rows
  // carry elf 0x08000FF8 and delta 8, the rescored row elf 0x08001000 and delta 0.
  const rulers = { elf: 0x0800_1000, poc: 0x0800_0ff8 };
  const pocRow = { ...BASELINE, codeEnd: { found: '0x08001000', elf: '0x08000FF8', delta: 8 } };
  assert.deepEqual(asScored(pocRow, rulers), {
    row: { ...pocRow, codeEnd: { found: '0x08001000', elf: '0x08001000', delta: 0 } },
    pocRuler: undefined,
  });
  const dump8 = { ...DUMP, pocRow: { ...pocRow, signatures: { functions: 94, seconds: 0.1 } } };
  const r = checkPocRom('tiny', ROW, dump8, pocRow, PINNED, rulers);
  assert.deepEqual([r.rowsEqual, r.pocRowEqual, r.diffs], [true, true, []]);
  // Compared field for field without the translation, the rescored row would differ on the ruler alone.
  assert.deepEqual(
    jsonDiffs(withoutPaths(pocRow, ['codeEnd.found']), withoutPaths({ ...ROW }, ['codeEnd.found'])).filter((d) =>
      d.startsWith('codeEnd'),
    ),
    ['codeEnd.delta: expected 8, got 0', 'codeEnd.elf: expected "0x08000FF8", got "0x08001000"'],
  );
  // A reference whose ELF code end is not the PoC's convention's fails: the PoC's numbers are not reproduced.
  const off = checkPocRom(
    'tiny',
    ROW,
    dump8,
    { ...pocRow, codeEnd: { found: '0x08001000', elf: '0x08001000', delta: 0 } },
    PINNED,
    rulers,
  );
  assert.equal(off.rowsEqual, false);
  assert.deepEqual(
    off.diffs.filter((d) => d.startsWith('row ')),
    ["row codeEnd under the PoC's convention: expected elf 0x08000FF8 and delta 8, the reference has 0x08001000 and 0"],
  );
  // A found code end that differs still fails, under either ruler.
  const moved = checkPocRom(
    'tiny',
    { ...ROW, codeEnd: { found: '0x08001004', elf: '0x08001000', delta: 4 } },
    dump8,
    pocRow,
    PINNED,
    rulers,
  );
  assert.deepEqual(moved.diffs, [
    'row codeEnd.delta: expected 0, got 4',
    'row codeEnd.found: expected "0x08001000", got "0x08001004"',
  ]);
  // The same for a revealed ROM, against the PoC's own row.
  const revealed = checkPocRom('tiny', ROW, dump8, undefined, PINNED, rulers, { pinnedMismatch: undefined });
  assert.deepEqual([revealed.rowsEqual, revealed.diffs], [true, []]);
  const revealedOff = checkPocRom(
    'tiny',
    ROW,
    dump8,
    undefined,
    PINNED,
    { elf: 0x0800_1000, poc: 0x0800_1000 },
    { pinnedMismatch: undefined },
  );
  assert.deepEqual(revealedOff.diffs, [
    "row (against the PoC's own row) codeEnd under the PoC's convention: expected elf 0x08001000 and delta 0, the reference has 0x08000FF8 and 8",
  ]);
});

test('stripSeconds drops every seconds key at any depth, so two dumps of one run are byte-equal', () => {
  assert.deepEqual(
    stripSeconds({
      seconds: 1,
      scaffold: { ok: true, seconds: 2, summary: 's' },
      signatures: { seconds: 3, versions: [{ seconds: 4, library: 'm4a' }] },
    }),
    {
      scaffold: { ok: true, summary: 's' },
      signatures: { versions: [{ library: 'm4a' }] },
    },
  );
});

test('withoutPaths and jsonDiffs', () => {
  assert.deepEqual(withoutPaths({ a: 1, b: { c: 2, d: 3 }, e: 4 }, ['e', 'b.c']), { a: 1, b: { d: 3 } });
  assert.deepEqual(jsonDiffs({ a: [1, 2], b: { c: 'x' } }, { a: [1, 3], b: { c: 'x' } }), ['a[1]: expected 2, got 3']);
  assert.deepEqual(jsonDiffs({ a: 1 }, { b: 1 }), ['a: expected 1, got absent', 'b: expected absent, got 1']);
  assert.deepEqual(jsonDiffs({ a: null }, { a: null }), []);
  assert.equal(jsonDiffs({ a: Array.from({ length: 50 }, (_, i) => i) }, { a: [] }, '', 5).length, 5);
});

test('a rescored row is compared without the categories of its misses and false entries (they describe the dataset)', () => {
  const value = {
    name: 'x',
    misses: [{ addr: '0x08000100', category: 'split-after-returning-call', listed: true }],
    falseEntries: [{ addr: '0x08000200', category: 'second-entry' }],
    tp: 1,
  };
  assert.deepEqual(withoutCategories(value), {
    name: 'x',
    misses: [{ addr: '0x08000100', listed: true }],
    falseEntries: [{ addr: '0x08000200' }],
    tp: 1,
  });
});
