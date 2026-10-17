// Fault injection into the dataset check (g1.checks-fail, architecture §8.3, §10): each fault, injected
// into the synthetic real tier, makes `bench dataset-check --json` exit 1 and report exactly the
// expected problem for the faulty row.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { withTempDir } from '../../unit/bench/fixtures.ts';
import { syntheticTier, tinyDump } from '../../unit/bench/harness.ts';
import type { ScoredRun } from '../../../bench/src/scored-run.ts';

interface Problem {
  readonly dataset: string;
  readonly list: string;
  readonly addr: string;
  readonly problem: string;
}

const NEEDED = { addr: '0x08000010', category: 'unreviewed', note: 'inside thumb_two' };

async function datasetCheck(name: string, overrides: Record<string, unknown>, dump?: ScoredRun): Promise<{ readonly code: number; readonly problems: readonly Problem[] }> {
  return withTempDir(`romlift-mut-dataset-${name}-`, async (root) => {
    const cx = await syntheticTier(join(root, 't'), { datasetOverrides: overrides, ...(dump === undefined ? {} : { dump }) });
    const lines: string[] = [];
    const io: BenchIo = { out: (l) => lines.push(l), err: () => {} };
    const code = await main(['dataset-check', '--json'], cx, io);
    const last = JSON.parse(lines.at(-1) ?? '{}') as { ok: boolean; problems: Problem[] };
    assert.equal(last.ok, code === 0);
    return { code, problems: last.problems };
  });
}

const label = (addr: string, category = 'loop-label'): Record<string, string> => ({ addr, name: `sub_${addr}`, category, note: 'injected' });

test('the unmutated synthetic dataset passes', async () => {
  assert.deepEqual(await datasetCheck('clean', {}), { code: 0, problems: [] });
});

test('a labels row that is not a FUNC symbol is reported as not-a-func', async () => {
  const { code, problems } = await datasetCheck('not-func', { labels: [label('0x0800000A')] });
  assert.equal(code, 1);
  assert.deepEqual(problems[0], { dataset: 'tiny', list: 'labels', addr: '0x0800000A', problem: 'not-a-func' });
});

test('an untyped row that is a FUNC symbol is reported as is-a-func', async () => {
  const { code, problems } = await datasetCheck('is-func', { untyped: [NEEDED, { addr: '0x08000018', category: 'veneer', note: 'injected' }] });
  assert.equal(code, 1);
  assert.deepEqual(problems[0], { dataset: 'tiny', list: 'untyped', addr: '0x08000018', problem: 'is-a-func' });
});

test('malformed hex is reported as malformed-address', async () => {
  const { code, problems } = await datasetCheck('hex', { untyped: [{ ...NEEDED, addr: '0x8000010' }] });
  assert.equal(code, 1);
  assert.deepEqual(problems, [{ dataset: 'tiny', list: 'untyped', addr: '0x8000010', problem: 'malformed-address' }]);
  const lower = await datasetCheck('lower', { labels: [label('0x0800000e')] });
  assert.deepEqual(lower.problems, [{ dataset: 'tiny', list: 'labels', addr: '0x0800000e', problem: 'malformed-address' }]);
});

test('an unknown category is reported as unknown-category', async () => {
  const { code, problems } = await datasetCheck('category', { untyped: [{ ...NEEDED, category: 'glued' }] });
  assert.equal(code, 1);
  assert.deepEqual(problems, [{ dataset: 'tiny', list: 'untyped', addr: '0x08000010', problem: 'unknown-category' }]);
});

test('a row the run no longer needs is reported as stale-exception', async () => {
  const base = tinyDump();
  const fixed: ScoredRun = { ...base, analysis: { ...base.analysis, functions: base.analysis.functions.filter((f) => f.entry !== '0x08000010') } };
  const { code, problems } = await datasetCheck('stale', {}, fixed);
  assert.equal(code, 1);
  assert.deepEqual(problems, [{ dataset: 'tiny', list: 'untyped', addr: '0x08000010', problem: 'stale-exception' }]);
});
