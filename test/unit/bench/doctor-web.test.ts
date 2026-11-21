import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { benchRun } from '../../../bench/src/run.ts';
import { apiResults } from '../../../bench/src/serve.ts';
import { withTempDir } from './fixtures.ts';
import { TINY_DEPS, runWith, syntheticTier } from './harness.ts';

test('the web report endpoint serves the artifact, its base, the verdict and the vocabularies', async () => {
  await withTempDir('romlift-web-', async (root) => {
    const cx = await syntheticTier(root);
    assert.equal((await apiResults(cx, join(root, 'none.json'))).status, 404);
    await benchRun(cx, runWith(TINY_DEPS));
    const artifact = join(cx.repoRoot, 'bench', 'results.json');
    const { status, body } = await apiResults(cx, artifact);
    assert.equal(status, 200);
    const b = body as {
      results: { roms: unknown[] };
      base: { ref: string };
      gate: string[];
      diff: unknown[];
      datasets: unknown[];
      vocab: Record<string, object>;
    };
    assert.equal(b.results.roms.length, 1);
    assert.equal(b.base.ref, artifact);
    assert.equal(b.gate.length, 1);
    assert.equal(b.diff.length, 1);
    assert.equal(b.datasets.length, 1);
    assert.deepEqual(Object.keys(b.vocab), ['missReasons', 'origins', 'categories']);
  });
});
