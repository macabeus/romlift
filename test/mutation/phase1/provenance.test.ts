// Fault injection into the provenance checks (g1.checks-fail, architecture §8.6, §10): after a clean
// `bench run` on the synthetic real tier, each fault makes `bench provenance --json` exit 1 with the
// expected check failing.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { printerSummary, withTempDir } from '../../unit/bench/fixtures.ts';
import { syntheticTier, TINY_DEPS } from '../../unit/bench/harness.ts';

interface Check {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

const quiet: BenchIo = { out: () => {}, err: () => {} };

async function provenance(cx: BenchContext): Promise<{ readonly code: number; readonly checks: Readonly<Record<string, Check>> }> {
  const lines: string[] = [];
  const code = await main(['provenance', '--json'], cx, { out: (l) => lines.push(l), err: () => {} });
  const last = JSON.parse(lines.at(-1) ?? '{}') as { ok: boolean; checks: Check[] };
  assert.equal(last.ok, code === 0);
  return { code, checks: Object.fromEntries(last.checks.map((c) => [c.id, c])) };
}

async function withRunTier(name: string, body: (cx: BenchContext) => Promise<void>, before?: (cx: BenchContext) => Promise<void>): Promise<void> {
  await withTempDir(`romlift-mut-prov-${name}-`, async (root) => {
    const cx = await syntheticTier(join(root, 't'));
    if (before) await before(cx);
    assert.equal(await main(['run'], cx, quiet, TINY_DEPS), 0);
    await body(cx);
  });
}

async function editJson(path: string, edit: (value: Record<string, unknown>) => void): Promise<void> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  edit(value);
  await writeFile(path, JSON.stringify(value));
}

test('the freshly generated artifact passes every check', async () => {
  await withRunTier('clean', async (cx) => {
    const { code, checks } = await provenance(cx);
    assert.equal(code, 0);
    assert.ok(Object.values(checks).every((c) => c.ok));
  });
});

test('a stale source digest fails source-digest with "re-run the real tier"', async () => {
  await withRunTier('digest', async (cx) => {
    await writeFile(join(cx.repoRoot, 'src', 'index.ts'), 'export const edited = true;\n');
    const { code, checks } = await provenance(cx);
    assert.equal(code, 1);
    assert.equal(checks['source-digest']?.ok, false);
    assert.match(checks['source-digest']?.detail ?? '', /re-run the real tier/);
    assert.equal(await main(['stale-check'], cx, quiet), 1);
  });
});

test('a row of a held-out dataset fails heldout-rows', async () => {
  await withRunTier('heldout', async (cx) => {
    // Sealing the dataset after the run leaves its row in the artifact (the edit also moves the digest).
    await editJson(join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json'), (d) => {
      d['heldout'] = true;
    });
    const { code, checks } = await provenance(cx);
    assert.equal(code, 1);
    assert.equal(checks['heldout-rows']?.ok, false);
    assert.match(checks['heldout-rows']?.detail ?? '', /sealed datasets: tiny/);
  });
});

test('a missing family fails families', async () => {
  await withRunTier(
    'family',
    async (cx) => {
      await editJson(join(cx.repoRoot, 'bench', 'results.json'), (r) => {
        r['printer'] = printerSummary();
        const meta = r['meta'] as { families: Record<string, string[]> };
        meta.families['tiny'] = ['code-end', 'entries', 'extents'];
      });
      const { code, checks } = await provenance(cx);
      assert.equal(code, 1);
      assert.equal(checks['families']?.ok, false);
      assert.match(checks['families']?.detail ?? '', /tiny: family scaffold did not run/);
    },
    async (cx) => {
      await writeFile(join(cx.repoRoot, 'test', 'gates', 'phase.json'), '{ "landed": 1 }');
    },
  );
});

test('landed 1 with no real-tier gate record fails gate-record', async () => {
  await withRunTier(
    'gates',
    async (cx) => {
      const { code, checks } = await provenance(cx);
      assert.equal(code, 1);
      assert.equal(checks['gate-record']?.ok, false);
      assert.match(checks['gate-record']?.detail ?? '', /g1\.fake-real has no real-tier record/);
    },
    async (cx) => {
      await writeFile(join(cx.repoRoot, 'test', 'gates', 'phase.json'), '{ "landed": 1 }');
      await writeFile(join(cx.repoRoot, 'test', 'gates', 'g1.fake-real.test.ts'), "gate({ id: 'g1.fake-real', phase: 1, tier: 'real', needs: [], async run() {} });\n");
    },
  );
});
