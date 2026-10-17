// `bench ablate` (g2.rule-coverage): decisive means a decision event of the 'decisions' trail cites the
// rule; changed means the entries, extents or code end move with the rule disabled. Runs on fixture
// directories laid out in a temporary repository and on the synthetic real tier, with a fake runner.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { TrailEvent } from 'romlift';

import { decisionSink, expectHolds, isAblatable, listFixtures, outcomeOf, parseFixtureExpect, pipelineIds } from '../../../bench/src/ablate.ts';
import { benchProfile } from '../../../bench/src/analysis-run.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { REPO_ROOT } from '../../../bench/src/context.ts';
import { readJson } from '../../../bench/src/files.ts';
import { analysisResult, fact, fixedRunner, withTempDir } from './fixtures.ts';
import { syntheticTier, TINY_DEPS } from './harness.ts';

const event = (kind: TrailEvent['kind'], rule: TrailEvent['rule']): TrailEvent => ({ kind, at: 0x0800_0100, rule, round: 1, cites: [] });

test('decisionSink: accept, reject, verdict, claim and absorb events of the rule are decisive; proposals and waits are not', () => {
  for (const kind of ['accept', 'reject', 'verdict', 'claim', 'absorb'] as const) {
    const sink = decisionSink('valid.dense');
    sink.event(event(kind, 'valid.dense'));
    assert.ok(sink.decisive(), kind);
  }
  const sink = decisionSink('valid.dense');
  for (const kind of ['propose', 'wait', 'place'] as const) sink.event(event(kind, 'valid.dense'));
  sink.event(event('reject', 'valid.decodes'));
  assert.ok(!sink.decisive());
});

const BASE = analysisResult([fact(0x0800_0100, 0x0800_0120), fact(0x0800_0120, 0x0800_0140)], { end: 0x0800_0100, entries: [] }, 0x0800_0140);

test('outcomeOf moves with an entry, a mode, an extent or the code end, and nothing else', () => {
  const same = { ...BASE, rejections: [{ at: 1, mode: 'thumb' as const, rule: 'valid.dense' as const, reason: 'not-dense' as const, intrinsic: true, round: 0, detail: '', count: 1 }] };
  assert.equal(outcomeOf(same), outcomeOf(BASE));
  assert.notEqual(outcomeOf({ ...BASE, codeEnd: 0x0800_0144 }), outcomeOf(BASE));
  assert.notEqual(outcomeOf({ ...BASE, functions: [fact(0x0800_0100, 0x0800_0140)] }), outcomeOf(BASE));
  assert.notEqual(outcomeOf({ ...BASE, functions: [fact(0x0800_0100, 0x0800_0120, 'call', 'arm'), fact(0x0800_0120, 0x0800_0140)] }), outcomeOf(BASE));
});

test('expect.json is read as g2.synthetic-analysis reads it, and judged the same way', () => {
  const expect = parseFixtureExpect({ negative: true, entries: [{ addr: '0x08000100', mode: 'thumb', extent: { start: '0x08000100', end: '0x08000120' } }, { addr: 0x0800_0120, mode: 'thumb' }], codeEnd: '0x08000140' }, 'x');
  assert.ok(expectHolds(expect, BASE));
  assert.ok(!expectHolds(expect, { ...BASE, codeEnd: 0x0800_0144 }));
  assert.ok(!expectHolds(expect, { ...BASE, functions: [...BASE.functions, fact(0x0800_0200, 0x0800_0204)] }));
  assert.ok(expectHolds({ ...expect, negative: false }, { ...BASE, functions: [...BASE.functions, fact(0x0800_0200, 0x0800_0204)] }));
  assert.throws(() => parseFixtureExpect({ entries: [{ addr: 'nowhere', mode: 'thumb' }] }, 'x'), /'nowhere' is not an address/);
});

test('the committed fixtures are listed with their expect.json, and every one parses', async () => {
  const fixtures = await listFixtures({ repoRoot: REPO_ROOT, benchRoot: REPO_ROOT, pocRoot: REPO_ROOT });
  assert.ok(fixtures.length >= 26);
  assert.ok(fixtures.some((f) => f.name === 'far-jump'));
  assert.ok(!fixtures.some((f) => f.name === 'common'));
  for (const f of fixtures) assert.ok(parseFixtureExpect(await readJson(f.expect), f.name).entries.length > 0, f.name);
});

test('a rule is ablatable when registered or named by the profile pipeline', () => {
  const profile = benchProfile();
  assert.ok(pipelineIds(profile.pipeline).includes('valid.dense'));
  assert.ok(isAblatable('valid.dense', profile));
  assert.ok(!isAblatable('valid.nothing', profile));
  assert.ok(!isAblatable('dense', profile));
});

function capture(): BenchIo & { readonly lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => lines.push(l), err: () => {} };
}

async function fixture(repoRoot: string, name: string, expect: unknown): Promise<void> {
  const dir = join(repoRoot, 'bench', 'dataset', 'synthetic', name);
  await mkdir(join(dir, 'build'), { recursive: true });
  await writeFile(join(dir, 'build', `${name}.gba`), new Uint8Array(0x100));
  await writeFile(join(dir, 'expect.json'), JSON.stringify(expect));
}

test('bench ablate --tier synthetic --json reports the fixtures where the rule decides and where its absence moves the outcome', async () => {
  await withTempDir('romlift-ablate-', async (root) => {
    const cx = await syntheticTier(root);
    await fixture(cx.repoRoot, 'alpha', { entries: [{ addr: '0x08000100', mode: 'thumb' }] });
    await fixture(cx.repoRoot, 'beta', { entries: [{ addr: '0x08000100', mode: 'thumb' }] });
    await mkdir(join(cx.repoRoot, 'bench', 'dataset', 'synthetic', 'common'), { recursive: true });
    const calls: { trail: string; disabled: readonly string[] }[] = [];
    const without = analysisResult([fact(0x0800_0100, 0x0800_0140)], { end: 0x0800_0100, entries: [] }, 0x0800_0140);
    const deps = {
      ...TINY_DEPS,
      runner: fixedRunner(BASE, { events: [event('accept', 'gap.forward-chain')], ablated: () => without, onAnalyze: (c) => calls.push(c) }),
    };
    const io = capture();
    assert.equal(await main(['ablate', 'gap.forward-chain', '--tier', 'synthetic', '--json'], cx, io, deps), 0);
    assert.deepEqual(JSON.parse(io.lines.at(-1) ?? ''), { schema: 'romlift/bench-ablate@1', rule: 'gap.forward-chain', tier: 'synthetic', decisiveIn: ['alpha', 'beta'], changed: ['alpha', 'beta'] });
    assert.deepEqual(calls, [
      { trail: 'decisions', disabled: [] },
      { trail: 'off', disabled: ['gap.forward-chain'] },
      { trail: 'decisions', disabled: [] },
      { trail: 'off', disabled: ['gap.forward-chain'] },
    ]);
    assert.match(io.lines[0] ?? '', /^alpha +decisive, outcome moves, expect\.json holds either way$/);
    // A rule no event cites and whose absence changes nothing.
    const idle = { ...TINY_DEPS, runner: fixedRunner(BASE, { events: [event('accept', 'gap.forward-chain')] }) };
    const quiet = capture();
    assert.equal(await main(['ablate', 'valid.dense', '--json', '--only', 'beta'], cx, quiet, idle), 0);
    assert.deepEqual(JSON.parse(quiet.lines.at(-1) ?? ''), { schema: 'romlift/bench-ablate@1', rule: 'valid.dense', tier: 'synthetic', decisiveIn: [], changed: [] });
    // The real tier runs the tuning datasets.
    const real = capture();
    assert.equal(await main(['ablate', 'gap.forward-chain', '--tier', 'real', '--json'], cx, real, deps), 0);
    assert.deepEqual(JSON.parse(real.lines.at(-1) ?? ''), { schema: 'romlift/bench-ablate@1', rule: 'gap.forward-chain', tier: 'real', decisiveIn: ['tiny'], changed: ['tiny'] });
    // Usage errors.
    assert.equal(await main(['ablate'], cx, capture(), deps), 2);
    assert.equal(await main(['ablate', 'valid.nothing'], cx, capture(), deps), 2);
    assert.equal(await main(['ablate', 'valid.dense', '--tier', 'held-out'], cx, capture(), deps), 2);
    assert.equal(await main(['ablate', 'valid.dense', '--only', 'nope'], cx, capture(), deps), 1);
  });
});
