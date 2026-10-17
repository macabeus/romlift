// Fault injection into the regression reporter (g2.checks-fail, architecture §8.5, §10): `bench
// regression --json` compares two artifacts written by a clean `bench run` on the synthetic real tier.
// Unchanged, they agree; then fewer true positives and a new extent mismatch in the fresh artifact, and a
// `labels` row committed without a `Bench-Exception: <rom> <addr> <reason>` trailer since the base
// commit, each make it exit 1 with exactly its problem kind, on the romlift/bench-regression@1 line.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { withTempDir } from '../../unit/bench/fixtures.ts';
import { syntheticTier, TINY_DEPS } from '../../unit/bench/harness.ts';

interface Problem {
  readonly kind: string;
  readonly rom: string;
  readonly detail: string;
}

interface Report {
  readonly schema: string;
  readonly ok: boolean;
  readonly base: string;
  readonly problems: readonly Problem[];
}

type Json = Record<string, unknown>;

/** thumb_two is the synthetic run's one miss: listing it makes the clean artifact pass on its own. */
const LISTED_MISS = { addr: '0x0800000E', name: 'thumb_two', category: 'loop-label', note: 'listed so the clean run has no unlisted miss' };
const ADDED_LABEL = { addr: '0x08000014', name: 'added_label', category: 'loop-label', note: 'injected' };

const quiet: BenchIo = { out: () => {}, err: () => {} };

async function regression(cx: BenchContext, args: readonly string[]): Promise<{ readonly code: number; readonly report: Report }> {
  const lines: string[] = [];
  const code = await main(['regression', ...args, '--json'], cx, { out: (l) => lines.push(l), err: () => {} });
  const report = JSON.parse(lines.at(-1) ?? '{}') as Report;
  assert.equal(report.schema, 'romlift/bench-regression@1');
  assert.deepEqual(Object.keys(report), ['schema', 'ok', 'base', 'problems']);
  assert.equal(report.ok, code === 0);
  assert.equal(report.ok, report.problems.length === 0);
  return { code, report };
}

/** The synthetic tier with thumb_two listed, after a clean `bench run`; `base` is a copy of its artifact. */
async function withArtifacts(name: string, body: (cx: BenchContext, files: { readonly base: string; readonly fresh: string; readonly clean: Json }) => Promise<void>): Promise<void> {
  await withTempDir(`romlift-mut-regression-${name}-`, async (root) => {
    const cx = await syntheticTier(join(root, 't'), { datasetOverrides: { labels: [LISTED_MISS] } });
    assert.equal(await main(['run'], cx, quiet, TINY_DEPS), 0);
    const text = await readFile(join(cx.repoRoot, 'bench', 'results.json'), 'utf8');
    const base = join(root, 'base.json');
    await writeFile(base, text);
    await body(cx, { base, fresh: join(root, 'fresh.json'), clean: JSON.parse(text) as Json });
  });
}

/** The artifact with its first row edited. */
function withRow(artifact: Json, edit: (row: Json) => Json): Json {
  const [first, ...rest] = artifact['roms'] as Json[];
  assert.ok(first !== undefined);
  return { ...artifact, roms: [edit(first), ...rest] };
}

test('two equal artifacts have no regression', async () => {
  await withArtifacts('clean', async (cx, { base }) => {
    const { code, report } = await regression(cx, ['--base', base, '--fresh', base]);
    assert.equal(code, 0);
    assert.deepEqual(report, { schema: 'romlift/bench-regression@1', ok: true, base, problems: [] });
  });
});

test('fewer true positives fail with kind true-positives', async () => {
  await withArtifacts('tp', async (cx, { base, fresh, clean }) => {
    const tp = (clean['roms'] as Json[])[0]?.['tp'];
    assert.equal(tp, 2);
    await writeFile(fresh, JSON.stringify(withRow(clean, (r) => ({ ...r, tp: 1 }))));
    const { code, report } = await regression(cx, ['--base', base, '--fresh', fresh]);
    assert.equal(code, 1);
    assert.deepEqual(report.problems, [{ kind: 'true-positives', rom: 'tiny', detail: 'true positives fell from 2 to 1' }]);
  });
});

test('a new extent mismatch fails with kind new-extent-mismatch', async () => {
  await withArtifacts('extent', async (cx, { base, fresh, clean }) => {
    const mismatch = { addr: '0x08000018', name: 'thumb_three', elf: 8, found: 4 };
    await writeFile(
      fresh,
      JSON.stringify(
        withRow(clean, (r) => {
          const extents = r['extents'] as Json;
          return { ...r, extents: { ...extents, agree: Number(extents['agree']) - 1, mismatches: [mismatch] } };
        }),
      ),
    );
    const { code, report } = await regression(cx, ['--base', base, '--fresh', fresh]);
    assert.equal(code, 1);
    assert.deepEqual(report.problems, [{ kind: 'new-extent-mismatch', rom: 'tiny', detail: 'new extent mismatch at 0x08000018 thumb_three: found 4, ELF 8' }]);
  });
});

/** git in `repo`, isolated from the user's and the system's configuration (no signing, a fixed identity). */
function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'romlift test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'romlift test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  }).trim();
}

async function addLabel(cx: BenchContext): Promise<void> {
  const file = join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json');
  const d = JSON.parse(await readFile(file, 'utf8')) as Json;
  await writeFile(file, JSON.stringify({ ...d, labels: [LISTED_MISS, ADDED_LABEL] }));
}

test('a labels row committed without a Bench-Exception trailer fails with kind untrailered-row; with one it passes', async () => {
  await withArtifacts('trailer', async (cx) => {
    git(cx.repoRoot, ['init', '-q']);
    git(cx.repoRoot, ['add', '-A']);
    git(cx.repoRoot, ['commit', '-q', '-m', 'The base: a clean artifact and its dataset']);
    const base = git(cx.repoRoot, ['rev-parse', 'HEAD']);
    // The control: the base against itself.
    assert.equal((await regression(cx, ['--base', base])).code, 0);

    await addLabel(cx);
    git(cx.repoRoot, ['commit', '-q', '-am', 'Add a labels row\n\nNo trailer here.']);
    const bare = await regression(cx, ['--base', base]);
    assert.equal(bare.code, 1);
    assert.equal(bare.report.base, base);
    assert.deepEqual(bare.report.problems, [{ kind: 'untrailered-row', rom: 'tiny', detail: "labels row 0x08000014 was added without a 'Bench-Exception: tiny 0x08000014 <reason>' trailer" }]);

    // A trailer for another ROM or address does not count; the right one does.
    git(cx.repoRoot, ['commit', '-q', '--allow-empty', '-m', 'Explain a row\n\nBench-Exception: other 0x08000014 wrong rom\nBench-Exception: tiny 0x08000016 wrong address']);
    assert.equal((await regression(cx, ['--base', base])).report.problems[0]?.kind, 'untrailered-row');
    git(cx.repoRoot, ['commit', '-q', '--allow-empty', '-m', 'Explain the row\n\nBench-Exception: tiny 0x08000014 a loop label the ELF types as a function']);
    const trailered = await regression(cx, ['--base', base]);
    assert.equal(trailered.code, 0);
    assert.deepEqual(trailered.report.problems, []);
  });
});
