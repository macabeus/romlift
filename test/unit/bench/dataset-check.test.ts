import assert from 'node:assert/strict';
import { test } from 'node:test';

// The dataset check against romlift's own run (a hand-built analysis and its miss diagnoses), the
// command end to end on the synthetic tier, and the tuning-set pin.
import { checkDatasetAgainstRun, checkTuningSet, datasetCheck, expectedTuningSet } from '../../../bench/src/dataset-check.ts';
import { analysisFunctions, scoreAnalysis } from '../../../bench/src/score.ts';
import { elfCodeEnd, elfTruth, pocCodeEnd } from '../../../bench/src/truth.ts';
import { analysisResult, dataset, elfFile, fact, failingRunner, fixedRunner, withTempDir } from './fixtures.ts';
import { syntheticTier, TINY_DEPS, tinyDeps, tinyResult } from './harness.ts';

const ELF = elfFile([
  { name: 'host', value: 0x0800_0101, size: 0x40 },
  { name: 'inner', value: 0x0800_0121, size: 0 },
  { name: 'free', value: 0x0800_0301, size: 8 },
]);
const TRUTH = elfTruth(ELF, 0x1000);
const RESULT = analysisResult([fact(0x0800_0100, 0x0800_0140), fact(0x0800_0200, 0x0800_0210, 'gap-scan')], { end: 0x0800_0000, entries: [] }, 0x0800_0210);
const DIAGNOSES = [
  { addr: 0x0800_0120, mode: 'thumb' as const, reason: 'inside-code' as const, detail: 'inside code' },
  { addr: 0x0800_0300, mode: 'thumb' as const, reason: 'unanchored' as const, detail: 'valid but not accepted' },
];

function problems(labels: readonly string[], untyped: readonly string[]): string[] {
  const d = dataset({
    labels: labels.map((addr) => ({ addr, name: `sub_${addr}`, category: 'loop-label', note: 'n' })),
    untyped: untyped.map((addr) => ({ addr, category: 'unreviewed', note: 'n' })),
  });
  const row = scoreAnalysis({ result: RESULT, diagnoses: DIAGNOSES, truth: TRUTH, dataset: d, sha1: '', deterministic: true });
  return checkDatasetAgainstRun(d, TRUTH, analysisFunctions(RESULT), row).map((p) => `${p.list} ${p.addr} ${p.problem}`);
}

test('a label that is a FUNC inside a found function and still missed, and a needed untyped row, pass', () => {
  assert.deepEqual(problems(['0x08000120'], ['0x08000200']), []);
});

test('a label that is not a FUNC symbol is reported', () => {
  assert.deepEqual(problems(['0x08000124'], []), ['labels 0x08000124 not-a-func', 'labels 0x08000124 stale-exception']);
});

test('a label that is a FUNC outside every found function is reported', () => {
  assert.deepEqual(problems(['0x08000300'], []), ['labels 0x08000300 not-inside-found-function']);
});

test('a label the run finds as an entry is not inside a found function and is stale', () => {
  assert.deepEqual(problems(['0x08000100'], []), ['labels 0x08000100 not-inside-found-function', 'labels 0x08000100 stale-exception']);
});

test('an untyped row that is a FUNC symbol is reported', () => {
  assert.deepEqual(problems([], ['0x08000300']), ['untyped 0x08000300 is-a-func', 'untyped 0x08000300 stale-exception']);
});

test('an untyped row the run no longer reports is stale', () => {
  assert.deepEqual(problems([], ['0x08000208']), ['untyped 0x08000208 stale-exception']);
});

test('the tuning set is pinned to the baseline names: a missing or an extra unsealed dataset is a problem', () => {
  const names = ['fe7j', 'klonoa', 'sa2'];
  assert.deepEqual(checkTuningSet(names.map((name) => ({ name })), names), []);
  const flipped = checkTuningSet([{ name: 'fe7j' }, { name: 'sa2' }], names);
  assert.deepEqual(flipped.map((p) => [p.dataset, p.problem]), [['klonoa', 'tuning-set']]);
  const extra = checkTuningSet([...names, 'tmc'].map((name) => ({ name })), names);
  assert.deepEqual(extra.map((p) => [p.dataset, p.problem]), [['tmc', 'tuning-set']]);
});

test('a revealed held-out dataset joins the expected tuning set; a sealed one or an unrevealed flip does not', () => {
  const reveal = { at: '2026-10-17T00:00:00Z', commit: 'abc', reason: 'owner decision' };
  const datasets = [
    { name: 'tmc', heldout: true, revealed: [reveal] },
    { name: 'pokeruby', heldout: true, revealed: [] },
    { name: 'fe7j', heldout: false, revealed: [] },
  ];
  assert.deepEqual(expectedTuningSet(['fe7j', 'klonoa'], datasets), ['fe7j', 'klonoa', 'tmc']);
  // A held-out dataset run as tuning data without a reveal is still an extra unsealed dataset.
  const extra = checkTuningSet([{ name: 'fe7j' }, { name: 'klonoa' }, { name: 'pokeruby' }], expectedTuningSet(['fe7j', 'klonoa'], datasets.slice(1)));
  assert.deepEqual(extra.map((p) => [p.dataset, p.problem]), [['pokeruby', 'tuning-set']]);
});

test("dataset-check runs romlift's analysis: the synthetic tier passes, a row the run no longer needs is stale", async () => {
  await withTempDir('romlift-dscheck-', async (root) => {
    const cx = await syntheticTier(root);
    assert.deepEqual(await datasetCheck(cx, TINY_DEPS.runner), { ok: true, problems: [] });
    // The PoC dump is not read: dropping the false entry from romlift's run makes its untyped row stale.
    const stale = await datasetCheck(cx, tinyDeps(tinyResult([0x0800_0010])).runner);
    assert.deepEqual(stale.problems.map((p) => [p.list, p.addr, p.problem]), [['untyped', '0x08000010', 'stale-exception']]);
    // An analysis that throws is reported for its dataset, not raised.
    const failed = await datasetCheck(cx, failingRunner());
    assert.deepEqual(failed.problems.map((p) => [p.dataset, p.problem]), [['tiny', 'input-unavailable']]);
    assert.match(failed.problems[0]?.detail ?? '', /the analysis failed: profile agbcc: pipeline rule/);
    // A single run diagnoses every ELF function of the ROM.
    const asked: number[] = [];
    const runner = fixedRunner(tinyResult(), { reasons: new Map([[0x0800_000e, 'unanchored']]) });
    const counting = { ...runner, diagnose: ((...args: Parameters<typeof runner.diagnose>) => (asked.push(args[4].length), runner.diagnose(...args))) as typeof runner.diagnose };
    assert.equal((await datasetCheck(cx, counting)).ok, true);
    assert.deepEqual(asked, [4]);
  });
});

test('the ELF code end (D60 j, D61 a): a sized function at addr + size, an unsized one at the first data mapping or typed symbol after it', () => {
  const elf = elfFile([
    { name: 'host', value: 0x0800_0101, size: 0x40 },
    { name: 'last', value: 0x0800_0200, size: 0 },
    { name: 'label', value: 0x0800_0220, size: 0, type: 'notype' },
    { name: '$d', value: 0x0800_0230, size: 0, type: 'notype' },
    { name: 'table', value: 0x0800_0240, size: 8, type: 'object' },
  ]);
  const truth = elfTruth(elf, 0x1000);
  assert.equal(elfCodeEnd(truth), 0x0800_0230, 'a code label does not end the function; the $d does');
  assert.equal(pocCodeEnd(truth), 0x0800_0200, "the PoC's convention ends it where it starts");
  const result = analysisResult([fact(0x0800_0100, 0x0800_0140), fact(0x0800_0200, 0x0800_0230, 'call')], { end: 0x0800_0000, entries: [] }, 0x0800_0230);
  const row = scoreAnalysis({ result, diagnoses: [], truth, dataset: dataset(), sha1: '', deterministic: true });
  assert.deepEqual(row.codeEnd, { found: '0x08000230', elf: '0x08000230', delta: 0 }, 'the scorer uses the one convention, no dataset row');
  // A Thumb FUNC symbol after an unsized function ends it at its address with the Thumb bit cleared.
  const thumbNext = elfTruth(elfFile([{ name: 'a', value: 0x0800_0301, size: 0 }, { name: 'b', value: 0x0800_0309, size: 0 }, { name: 'o', value: 0x0800_0310, size: 4, type: 'object' }]), 0x1000);
  assert.equal(elfCodeEnd(thumbNext), 0x0800_0310);
  // A sized last function ends at addr + size, its pool included.
  const sized = elfTruth(elfFile([{ name: 'host', value: 0x0800_0101, size: 0x40 }, { name: 'last', value: 0x0800_0200, size: 0x30 }, { name: '$d', value: 0x0800_0220, size: 0, type: 'notype' }]), 0x1000);
  assert.equal(elfCodeEnd(sized), 0x0800_0230);
  // A numbered data mapping symbol ($d.N) and a SECTION symbol end an unsized function too; $t and $a do not.
  const numbered = elfTruth(elfFile([{ name: 'a', value: 0x0800_0501, size: 0 }, { name: '$t', value: 0x0800_0504, size: 0, type: 'notype' }, { name: '$d.7', value: 0x0800_0510, size: 0, type: 'notype' }]), 0x1000);
  assert.equal(elfCodeEnd(numbered), 0x0800_0510);
  const section = elfTruth(elfFile([{ name: 'a', value: 0x0800_0601, size: 0 }, { name: '$a', value: 0x0800_0604, size: 0, type: 'notype' }, { name: '.rodata', value: 0x0800_0620, size: 0, type: 'section' }]), 0x1000);
  assert.equal(elfCodeEnd(section), 0x0800_0620);
  // An unsized function with nothing after it ends where it starts.
  assert.equal(elfCodeEnd(elfTruth(elfFile([{ name: 'only', value: 0x0800_0400, size: 0 }]), 0x1000)), 0x0800_0400);
  // A sized function that ends past an unsized later one decides: the maximum over every function, not the
  // end of the highest-address one (gate-honesty-r1-2), with or without a $d after the later one.
  assert.equal(elfCodeEnd(elfTruth(elfFile([{ name: 'big', value: 0x0800_0101, size: 0x400 }, { name: 'only', value: 0x0800_0400, size: 0 }]), 0x1000)), 0x0800_0500);
  const below = elfTruth(elfFile([{ name: 'big', value: 0x0800_0101, size: 0x400 }, { name: 'only', value: 0x0800_0400, size: 0 }, { name: '$d', value: 0x0800_0420, size: 0, type: 'notype' }]), 0x1000);
  assert.equal(elfCodeEnd(below), 0x0800_0500);
  // An inline pool mid-function ($t, $d, $t, $d): the code resumes after the first $d, so the $d that
  // closes the last code run before the next typed symbol ends it (overfitting-correctness-r1-2).
  const inline = elfTruth(
    elfFile([
      { name: 'a', value: 0x0800_0700, size: 0 },
      { name: '$t', value: 0x0800_0700, size: 0, type: 'notype' },
      { name: '$d', value: 0x0800_0720, size: 0, type: 'notype' },
      { name: '$t', value: 0x0800_0728, size: 0, type: 'notype' },
      { name: '$d', value: 0x0800_0740, size: 0, type: 'notype' },
      { name: 'next', value: 0x0800_0760, size: 4, type: 'object' },
    ]),
    0x1000,
  );
  assert.equal(elfCodeEnd(inline), 0x0800_0740, 'the inline pool at 0x08000720 does not end it');
  assert.equal(pocCodeEnd(inline), 0x0800_0700);
  // A code mapping symbol past the next typed symbol belongs to what follows it, not to the unsized function.
  const after = elfTruth(
    elfFile([
      { name: 'a', value: 0x0800_0800, size: 0 },
      { name: '$d', value: 0x0800_0810, size: 0, type: 'notype' },
      { name: 'obj', value: 0x0800_0818, size: 4, type: 'object' },
      { name: '$a', value: 0x0800_081C, size: 0, type: 'notype' },
    ]),
    0x1000,
  );
  assert.equal(elfCodeEnd(after), 0x0800_0810);
});
