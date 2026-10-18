import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { contextFromEnv } from '../../../bench/src/context.ts';
import { isSealed, loadDatasets, parseDataset, pocDatasets, tuningDatasets, type DatasetProblemId } from '../../../bench/src/dataset.ts';
import { dataset, withTempDir } from './fixtures.ts';

const TUNING = {
  klonoa: 'kleod',
  sa2: 'sat-r',
  sa3: 'sat-r',
  fe7j: 'fe-gba',
  pokeemerald: 'pret-gen3',
  tmc: 'zeldaret-tmc',
} as const;

test('the tuning datasets the PoC baseline names: tmc, revealed later (D60), is tuning data with no baseline row', async () => {
  const loaded = await loadDatasets(contextFromEnv({}));
  const names = (ds: readonly { readonly name: string }[]): string[] => ds.map((d) => d.name);
  assert.deepEqual(names(tuningDatasets(loaded.datasets)), ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc']);
  const poc = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];
  assert.deepEqual(names(pocDatasets(loaded.datasets, poc)), poc);
  assert.deepEqual(names(pocDatasets(loaded.datasets, poc, 'tmc')), []);
  assert.deepEqual(names(pocDatasets(loaded.datasets, poc, 'sa2')), ['sa2']);
});

test('the six committed tuning datasets are well formed and record their digests and family (tmc revealed, D60)', async () => {
  const loaded = await loadDatasets(contextFromEnv({}));
  assert.deepEqual(loaded.problems, []);
  // The sealed held-out datasets beside them are checked by seal.test.ts.
  const datasets = tuningDatasets(loaded.datasets);
  assert.deepEqual(
    datasets.map((d) => d.name),
    ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc'],
  );
  for (const d of datasets) {
    assert.equal(d.family, TUNING[d.name as keyof typeof TUNING]);
    // The five were tuning data from the start; tmc is held-out data revealed by the owner's decision.
    if (d.name === 'tmc') {
      assert.equal(d.heldout, true);
      assert.equal(d.revealed.length, 1);
    } else {
      assert.equal(d.heldout, false);
      assert.deepEqual(d.revealed, []);
    }
    assert.match(d.sha1, /^[0-9a-f]{40}$/);
    assert.match(d.elfSha256, /^[0-9a-f]{64}$/);
    assert.ok(d.map !== undefined && d.buildNote !== '' && d.elfCommit !== '');
  }
  assert.equal(datasets.length, 6);
  assert.deepEqual(
    tuningDatasets(datasets, 'sa3').map((d) => d.name),
    ['sa3'],
  );
});

function problemsOf(value: unknown): DatasetProblemId[] {
  return parseDataset(value, 'bench/dataset/real/tiny.json').problems.map((p) => p.problem);
}

const row = { addr: '0x08000100', name: 'sub_08000100', category: 'loop-label', note: 'n' };

test('a well-formed dataset parses with no problem', () => {
  const parsed = parseDataset({ ...dataset(), labels: [row], untyped: [{ addr: '0x08000200', category: 'veneer', note: 'n' }] }, 'x.json');
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.dataset?.labels.length, 1);
  assert.equal(parsed.dataset?.untyped[0]?.name, undefined);
});

test('structural problems are each reported with their id', () => {
  assert.deepEqual(problemsOf({ ...dataset(), labels: [{ ...row, addr: '0x8000100' }] }), ['malformed-address']);
  assert.deepEqual(problemsOf({ ...dataset(), labels: [{ ...row, addr: '0x0800010a' }] }), ['malformed-address']);
  assert.deepEqual(problemsOf({ ...dataset(), labels: [row, row] }), ['duplicate-address']);
  assert.deepEqual(problemsOf({ ...dataset(), untyped: [{ ...row, category: 'glued' }] }), ['unknown-category']);
  assert.deepEqual(problemsOf({ ...dataset(), labels: [{ addr: '0x08000100', category: 'loop-label', note: 'n' }] }), ['missing-field']);
  assert.deepEqual(problemsOf({ ...dataset(), heldout: 'no' }), ['missing-field']);
  assert.deepEqual(problemsOf({ ...dataset(), revealed: {} }), ['missing-field']);
  const { elfSha256: _, ...noDigest } = dataset();
  assert.deepEqual(problemsOf(noDigest), ['missing-field']);
  assert.deepEqual(problemsOf({ ...dataset(), sha1: 'ABC' }), ['missing-field']);
  assert.deepEqual(problemsOf([]), ['unreadable']);
});

test('the same address may appear once in each list', () => {
  assert.deepEqual(problemsOf({ ...dataset(), labels: [row], untyped: [row] }), []);
});

test('a dataset is sealed while held out and never revealed', () => {
  assert.ok(!isSealed(dataset()));
  assert.ok(isSealed(dataset({ heldout: true })));
  assert.ok(!isSealed(dataset({ heldout: true, revealed: [{ at: '2026-10-17', commit: 'abc', reason: 'r' }] })));
  assert.deepEqual(tuningDatasets([dataset({ name: 'a' }), dataset({ name: 'b', heldout: true })]).map((d) => d.name), ['a']);
});

test('the loader reads only real/*.json, in code-unit order', async () => {
  await withTempDir('romlift-dataset-', async (repo) => {
    const dir = join(repo, 'bench', 'dataset', 'real');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await mkdir(join(repo, 'bench', 'dataset', 'synthetic'), { recursive: true });
    for (const name of ['b', 'C', 'a']) await writeFile(join(dir, `${name}.json`), JSON.stringify(dataset({ name })));
    await writeFile(join(dir, 'notes.txt'), 'not a dataset');
    await writeFile(join(dir, 'nested', 'c.json'), JSON.stringify(dataset({ name: 'c' })));
    await writeFile(join(repo, 'bench', 'dataset', 'synthetic', 'd.json'), JSON.stringify(dataset({ name: 'd' })));
    await writeFile(join(dir, 'broken.json'), '{');
    const { datasets, problems } = await loadDatasets({ repoRoot: repo, benchRoot: repo, pocRoot: repo });
    assert.deepEqual(datasets.map((d) => d.name), ['C', 'a', 'b']);
    assert.deepEqual(problems.map((p) => [p.dataset, p.problem]), [['broken', 'unreadable']]);
  });
});

test('a retired category is an unknown category, except when reading an older commit (retired)', () => {
  const old = { ...dataset(), labels: [{ ...row, category: 'continuation-after-noreturn-call' }] };
  assert.deepEqual(problemsOf(old), ['unknown-category']);
  assert.deepEqual(parseDataset(old, 'x.json', { retired: true }).problems, []);
  assert.deepEqual(problemsOf({ ...dataset(), labels: [{ ...row, category: 'unreviewed' }] }), [], 'the adopt placeholder parses; g2.no-unreviewed refuses it');
});

