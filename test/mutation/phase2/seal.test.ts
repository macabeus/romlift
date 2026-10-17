// Fault injection into the seal (g2.checks-fail, architecture §8.4 "Held-out runs", §8.6, §10, D25): on
// the synthetic real tier with one sealed dataset, a clean `bench run` passes the provenance checks;
// then a row of the sealed dataset injected into bench/results.json fails the heldout-rows check,
// `bench adopt` on the sealed dataset exits 1 with its refusal and leaves the dataset as it was, and a
// sealed entry carrying an address fails assertCountsOnly, both in the run's own output and when the
// artifact is read back.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import { checkHeldoutRows } from '../../../bench/src/provenance.ts';
import { assertCountsOnly, sealedCounts } from '../../../bench/src/seal.ts';
import { dataset, results, row, withTempDir } from '../../unit/bench/fixtures.ts';
import { syntheticTier, TINY_DEPS } from '../../unit/bench/harness.ts';

const SEALED = 'held';

interface Check {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface Captured extends BenchIo {
  readonly lines: string[];
  readonly errors: string[];
}

function capture(): Captured {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

const datasetFile = (cx: BenchContext, name: string): string => join(cx.repoRoot, 'bench', 'dataset', 'real', `${name}.json`);
const resultsFile = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'results.json');

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}

/** The synthetic tier plus a sealed copy of its dataset (held out, never revealed, no lists), after a clean `bench run`. */
async function withSealedTier(name: string, body: (cx: BenchContext) => Promise<void>): Promise<void> {
  await withTempDir(`romlift-mut-seal-${name}-`, async (root) => {
    const cx = await syntheticTier(join(root, 't'));
    const tiny = await readJsonFile(datasetFile(cx, 'tiny'));
    await writeFile(datasetFile(cx, SEALED), `${JSON.stringify({ ...tiny, name: SEALED, family: 'other-family', heldout: true, revealed: [], labels: [], untyped: [] }, null, 2)}\n`);
    assert.equal(await main(['run'], cx, capture(), TINY_DEPS), 0);
    await body(cx);
  });
}

async function provenance(cx: BenchContext): Promise<{ readonly code: number; readonly checks: Readonly<Record<string, Check>> }> {
  const io = capture();
  const code = await main(['provenance', '--json'], cx, io);
  const last = JSON.parse(io.lines.at(-1) ?? '{}') as { ok: boolean; checks: Check[] };
  assert.equal(last.ok, code === 0);
  return { code, checks: Object.fromEntries(last.checks.map((c) => [c.id, c])) };
}

test('the clean run keeps the sealed dataset to counts, and its artifact passes heldout-rows', async () => {
  await withSealedTier('clean', async (cx) => {
    const written = await readJsonFile(resultsFile(cx));
    assert.deepEqual((written['roms'] as { name: string }[]).map((r) => r.name), ['tiny']);
    const sealed = written['sealed'] as Record<string, unknown>[];
    assert.deepEqual(sealed.map((s) => s['name']), [SEALED]);
    for (const entry of sealed) assertCountsOnly(entry);
    const { checks } = await provenance(cx);
    assert.equal(checks['heldout-rows']?.ok, true);
    assert.match(checks['heldout-rows']?.detail ?? '', /no row of the 1 sealed dataset/);
  });
});

test('a held-out row injected into results.json fails heldout-rows and exits 1', async () => {
  await withSealedTier('row', async (cx) => {
    const written = await readJsonFile(resultsFile(cx));
    const [tinyRow] = written['roms'] as Record<string, unknown>[];
    assert.ok(tinyRow !== undefined);
    written['roms'] = [{ ...tinyRow, name: SEALED }, tinyRow];
    await writeFile(resultsFile(cx), JSON.stringify(written));
    const { code, checks } = await provenance(cx);
    assert.equal(code, 1);
    assert.equal(checks['heldout-rows']?.ok, false);
    assert.equal(checks['heldout-rows']?.detail, `the artifact holds rows of sealed datasets: ${SEALED}`);
    // The injected row is the only fault: every other check still passes.
    assert.deepEqual(
      Object.values(checks)
        .filter((c) => !c.ok)
        .map((c) => c.id),
      ['heldout-rows'],
    );
  });
});

test('the heldout-rows check alone: a sealed dataset with a row fails, a revealed one does not', () => {
  const sealed = dataset({ name: SEALED, heldout: true });
  const artifact = results([row({ name: SEALED })]);
  assert.deepEqual(checkHeldoutRows(artifact, [sealed]), { id: 'heldout-rows', ok: false, detail: `the artifact holds rows of sealed datasets: ${SEALED}` });
  const revealed = dataset({ name: SEALED, heldout: true, revealed: [{ at: '2026-10-17', commit: 'abc1234', reason: 'diagnosis' }] });
  assert.equal(checkHeldoutRows(artifact, [revealed]).ok, true);
});

test('bench adopt on the sealed dataset exits 1 with its refusal and writes nothing', async () => {
  await withSealedTier('adopt', async (cx) => {
    const before = await readFile(datasetFile(cx, SEALED), 'utf8');
    const io = capture();
    assert.equal(await main(['adopt', SEALED], cx, io, TINY_DEPS), 1);
    assert.deepEqual(io.lines, []);
    assert.equal(io.errors.length, 1);
    assert.match(io.errors[0] ?? '', new RegExp(`^${SEALED} is sealed \\(held out, never revealed\\): adopt refuses it; reveal it first with bench run --reveal ${SEALED} --reason <text>`));
    assert.equal(await readFile(datasetFile(cx, SEALED), 'utf8'), before);
    // The control: the tuning dataset is adopted.
    assert.equal(await main(['adopt', 'tiny'], cx, capture(), TINY_DEPS), 0);
  });
});

test('a sealed entry carrying an address fails assertCountsOnly, naming the field and never the value', () => {
  const counts = sealedCounts({
    name: SEALED,
    found: [{ entry: 0x0800_0200, mode: 'thumb', extent: { start: 0x0800_0200, end: 0x0800_0210 }, holes: [], branchTargets: [], noReturnSites: [], origin: 'call' }],
    truth: [{ addr: 0x0800_0200, size: 0x10, thumb: true }],
    startupEnd: 0x0800_0100,
    isPrologue: () => false,
    codeEnd: 0x0800_0210,
  });
  assertCountsOnly(counts);
  const faults: readonly [Record<string, unknown>, RegExp][] = [
    [{ ...counts, firstMiss: 0x0800_0108 }, /^sealed field firstMiss is not a count$/],
    [{ ...counts, codeEnd: { delta: 0, found: 0x0800_0210 } }, /^sealed field codeEnd\.found is not a count$/],
    [{ ...counts, firstMiss: '0x08000108' }, /^sealed field firstMiss is a string; a sealed entry holds counts only$/],
    [{ ...counts, misses: [{ addr: 0x0800_0108 }] }, /^sealed field misses is not a count or a record of counts$/],
  ];
  for (const [entry, message] of faults) {
    assert.throws(() => assertCountsOnly(entry), (error: unknown) => error instanceof Error && message.test(error.message) && !error.message.includes('108'));
  }
});

test('an artifact whose sealed entry carries an address is refused when read back (exit 1)', async () => {
  await withSealedTier('artifact', async (cx) => {
    const written = await readJsonFile(resultsFile(cx));
    const [entry] = written['sealed'] as Record<string, unknown>[];
    written['sealed'] = [{ ...entry, firstMiss: 0x0800_0108 }];
    await writeFile(resultsFile(cx), JSON.stringify(written));
    const io = capture();
    assert.equal(await main(['provenance', '--json'], cx, io), 1);
    assert.match(io.errors.join('\n'), /sealed\[0\]: sealed field firstMiss is not a count/);
  });
});
