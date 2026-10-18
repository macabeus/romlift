// baselineRowsVerdict, the per-ROM verdict g2.baseline-rows calls (test/gates/baseline-rows-verdict.ts, D61 d).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BENCHMARK_ROWS, baselineRowsVerdict as verdictOf, type BaselineRowsInput } from '../../gates/baseline-rows-verdict.ts';
import { TMC_AT_D61 } from '../../gates/dataset-binding.ts';

/** The verdict on tmc's dataset as the owner decided on it, or on `dataset`. */
const baselineRowsVerdict = (r: BaselineRowsInput, dataset: { readonly sha1: string; readonly elfSha256?: string } = TMC_AT_D61, rows = BENCHMARK_ROWS) => verdictOf(r, dataset, rows);

function rom(over: Partial<BaselineRowsInput> = {}): BaselineRowsInput {
  return {
    name: 'tmc',
    tp: 8631,
    elfFunctions: 8636,
    recall: 8631 / 8636,
    poc: { source: 'dump' },
    misses: [{ addr: '0x080B20AC', listed: true, category: 'split-after-returning-call' }],
    falseEntries: [
      { addr: '0x080B1AA8', listed: true, category: 'pointer-entry' },
      { addr: '0x080B2718', listed: true, category: 'local-subroutine' },
    ],
    baselineRows: {
      diffs: [
        { kind: 'miss-removed', addr: '0x08000E92' },
        { kind: 'false-entry-added', addr: '0x080B1AA8' },
        { kind: 'miss-changed', addr: '0x080B20AC' },
        { kind: 'false-entry-added', addr: '0x080B2718' },
      ],
      unaccepted: [
        { kind: 'false-entry-added', addr: '0x080B1AA8' },
        { kind: 'miss-changed', addr: '0x080B20AC' },
        { kind: 'false-entry-added', addr: '0x080B2718' },
      ],
      staleAccepted: [],
    },
    ...over,
  };
}

test('the owner kept tmc, and only tmc, as a benchmark row at tp 8,631 of 8,636 (D61 d)', () => {
  assert.deepEqual(Object.keys(BENCHMARK_ROWS), ['tmc']);
  assert.deepEqual(BENCHMARK_ROWS['tmc']?.floor, { tp: 8631, elfFunctions: 8636 });
  assert.equal(BENCHMARK_ROWS['tmc']?.words, "Keep tmc as 99.94%. It's a benchmark row that we can improve later");
});

test('a benchmark row accepts the rows its dataset lists with a category, and prints them', () => {
  const v = baselineRowsVerdict(rom());
  assert.deepEqual(v.problems, []);
  assert.deepEqual(
    v.acceptedListed.map((d) => `${d.kind} ${d.addr} ${d.category}`),
    ['false-entry-added 0x080B1AA8 pointer-entry', 'miss-changed 0x080B20AC split-after-returning-call', 'false-entry-added 0x080B2718 local-subroutine'],
  );
  assert.match(v.note, /^tmc 1 accepted improvements against the PoC's own run, and 3 rows the PoC's run did not have accepted as listed with a category .*Keep tmc as 99\.94%.*floor tp 8631 of 8636 \(recall 99\.94%\), now tp 8631 \(99\.94%\)$/);
});

test('a benchmark row still fails on an unlisted or uncategorised row, an extent change, a stale diff, or a fall below its floor', () => {
  const unlisted = rom({ falseEntries: [{ addr: '0x080B1AA8', listed: false }, { addr: '0x080B2718', listed: true, category: 'local-subroutine' }] });
  assert.deepEqual(baselineRowsVerdict(unlisted).problems, ['tmc: 1 rows differ from the PoC baseline without an accepted diff or a listed category: false-entry-added 0x080B1AA8']);
  const uncategorised = rom({ misses: [{ addr: '0x080B20AC', listed: true }] });
  assert.equal(baselineRowsVerdict(uncategorised).problems.length, 1);
  const base = rom().baselineRows;
  const extent = rom({ baselineRows: { ...base, unaccepted: [...base.unaccepted, { kind: 'extent-changed', addr: '0x080B1AA8' }] } });
  assert.deepEqual(baselineRowsVerdict(extent).problems, ['tmc: 1 rows differ from the PoC baseline without an accepted diff or a listed category: extent-changed 0x080B1AA8']);
  const stale = rom({ baselineRows: { ...base, staleAccepted: [{ kind: 'miss-removed', addr: '0x08000288' }] } });
  assert.deepEqual(baselineRowsVerdict(stale).problems, ['tmc: 1 stale accepted diffs: miss-removed 0x08000288']);
  const fewer = rom({ tp: 8630, recall: 8630 / 8636 });
  assert.deepEqual(baselineRowsVerdict(fewer).problems, ["tmc: true positives 8630, below the benchmark row's 8631 (D61 d)", "tmc: recall 99.93%, below the benchmark row's 99.94% (D61 d)"]);
});

test('every other ROM is as strict as before: a listed row is not accepted without an accepted diff', () => {
  const five = rom({ name: 'sa2', poc: { source: 'baseline' } });
  assert.deepEqual(baselineRowsVerdict(five).problems, ['sa2: 3 rows differ from the PoC baseline without an accepted diff: false-entry-added 0x080B1AA8, miss-changed 0x080B20AC, false-entry-added 0x080B2718']);
  // A revealed ROM the owner did not make a benchmark row is strict too, and so is tmc without the decision.
  assert.equal(baselineRowsVerdict(rom({ name: 'kirby' })).problems.length, 1);
  assert.equal(baselineRowsVerdict(rom(), TMC_AT_D61, {}).problems.length, 1);
  // tmc with a baseline reference (a PoC row in the pinned baseline) would be judged as the five.
  assert.equal(baselineRowsVerdict(rom({ poc: { source: 'baseline' } })).problems.length, 1);
  assert.deepEqual(baselineRowsVerdict(rom({ name: 'sa2', poc: { source: 'baseline' }, baselineRows: { diffs: [], unaccepted: [], staleAccepted: [] } })).problems, []);
});

test('the benchmark row holds only for the ROM and ELF it was decided on (overfitting-correctness-r0-4)', () => {
  const rebuilt = baselineRowsVerdict(rom(), { ...TMC_AT_D61, elfSha256: '0'.repeat(64) });
  assert.equal(rebuilt.problems.length, 2);
  assert.match(rebuilt.problems[0] ?? '', /^tmc: the D61 d scoping was decided on ROM SHA-1 b4bd50e4.*the scoping is stale, a new owner decision is needed$/);
  assert.equal(rebuilt.problems[1], 'tmc: 3 rows differ from the PoC baseline without an accepted diff: false-entry-added 0x080B1AA8, miss-changed 0x080B20AC, false-entry-added 0x080B2718');
  assert.deepEqual(rebuilt.acceptedListed, []);
  assert.equal(baselineRowsVerdict(rom(), { sha1: 'c'.repeat(40), elfSha256: TMC_AT_D61.elfSha256 }).problems.length, 2);
  assert.equal(baselineRowsVerdict(rom(), { sha1: TMC_AT_D61.sha1 }).problems.length, 2);
  assert.deepEqual(BENCHMARK_ROWS['tmc']?.rom, TMC_AT_D61);
});

test('TMC_AT_D61 is the committed tmc dataset', async () => {
  const { readFile } = await import('node:fs/promises');
  const d = JSON.parse(await readFile(new URL('../../../bench/dataset/real/tmc.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  assert.equal(d['sha1'], TMC_AT_D61.sha1);
  assert.equal(d['elfSha256'], TMC_AT_D61.elfSha256);
});
