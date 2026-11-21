// Fault injection into the stale-exception check (g2.checks-fail, architecture §8.3, §10): the exception
// lists must stay exact, so a `labels` or `untyped` row the run no longer needs is a failure. On the
// synthetic real tier, romlift's run is changed so that it no longer reports the listed false entry
// (or no longer misses a listed label): the bench scorer reports the row in `staleExceptions`, the rule
// g2.entries applies to that field fails, and `bench dataset-check` reports `stale-exception` and exits 1.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AnalysisResult } from 'romlift';

import { type BenchIo, main } from '../../../bench/src/cli.ts';
import type { StaleException } from '../../../bench/src/row.ts';
import { staleExceptions } from '../../../bench/src/score.ts';
import { analysisResult, fact, withTempDir } from '../../unit/bench/fixtures.ts';
import { syntheticTier, tinyDeps, tinyResult } from '../../unit/bench/harness.ts';

/** The synthetic dataset's one untyped row: the false entry tinyResult reports inside thumb_two. */
const UNTYPED = '0x08000010';
/** thumb_two, the ELF FUNC tinyResult misses. */
const THUMB_TWO = '0x0800000E';

interface RunRom {
  readonly name: string;
  readonly staleExceptions: readonly StaleException[];
}

interface Problem {
  readonly dataset: string;
  readonly list: string;
  readonly addr: string;
  readonly problem: string;
}

function lastJson<T>(lines: readonly string[]): T {
  return JSON.parse(lines.at(-1) ?? '{}') as T;
}

/**
 * The staleness rule of test/gates/g2.entries.test.ts, applied to one `bench run --json` row: the gate is
 * real-tier and runs `npm run bench` on the real datasets, so its rule is restated here, word for word.
 */
function entriesStaleProblem(rom: RunRom): string | undefined {
  if (rom.staleExceptions.length === 0) return undefined;
  return `${rom.name}: stale-exception rows: ${rom.staleExceptions
    .slice(0, 8)
    .map((s) => `${s.list} ${s.addr}`)
    .join(', ')}`;
}

/** Runs `bench <args...> --json` on the synthetic tier with `datasetOverrides`, romlift's run being `result`. */
async function benchJson<T>(
  name: string,
  args: readonly string[],
  result: AnalysisResult,
  datasetOverrides: Record<string, unknown> = {},
): Promise<{ readonly code: number; readonly report: T; readonly lines: readonly string[] }> {
  return withTempDir(`romlift-mut-stale-${name}-`, async (root) => {
    const cx = await syntheticTier(join(root, 't'), { datasetOverrides });
    const lines: string[] = [];
    const io: BenchIo = { out: (l) => lines.push(l), err: () => {} };
    const code = await main([...args, '--json'], cx, io, tinyDeps(result));
    return { code, report: lastJson<T>(lines), lines };
  });
}

/** tinyResult, which misses thumb_two, now also finding it. */
function findsThumbTwo(): AnalysisResult {
  const base = tinyResult();
  return analysisResult(
    [...base.functions, fact(0x0800_000e, 0x0800_0018)],
    { end: 0x0800_0008, entries: [0x0800_0000] },
    base.codeEnd,
  );
}

test('unmutated, the scorer reports no stale row and the g2.entries rule holds', async () => {
  const { code, report } = await benchJson<{ roms: RunRom[] }>('clean', ['run'], tinyResult());
  assert.equal(code, 0);
  const [rom] = report.roms;
  assert.ok(rom !== undefined);
  assert.deepEqual(rom.staleExceptions, []);
  assert.equal(entriesStaleProblem(rom), undefined);
});

test('an untyped row the run no longer reports is a stale exception that fails g2.entries', async () => {
  const { code, report } = await benchJson<{ roms: RunRom[] }>('untyped', ['run'], tinyResult([0x0800_0010]));
  assert.equal(code, 0, 'bench run itself scores; the gate judges');
  const [rom] = report.roms;
  assert.ok(rom !== undefined);
  assert.deepEqual(rom.staleExceptions, [{ list: 'untyped', addr: UNTYPED }]);
  assert.equal(entriesStaleProblem(rom), `tiny: stale-exception rows: untyped ${UNTYPED}`);
});

test('a labels row the run no longer misses is a stale exception that fails g2.entries', async () => {
  const label = { addr: THUMB_TWO, name: 'thumb_two', category: 'loop-label', note: 'injected' };
  const { report } = await benchJson<{ roms: RunRom[] }>('labels', ['run'], findsThumbTwo(), { labels: [label] });
  const [rom] = report.roms;
  assert.ok(rom !== undefined);
  assert.deepEqual(rom.staleExceptions, [{ list: 'labels', addr: THUMB_TWO }]);
  assert.equal(entriesStaleProblem(rom), `tiny: stale-exception rows: labels ${THUMB_TWO}`);
});

test('the scorer alone: staleExceptions lists exactly the rows the row no longer needs', () => {
  const lists = {
    labels: [{ addr: THUMB_TWO, name: 'thumb_two', category: 'loop-label' as const, note: 'n' }],
    untyped: [{ addr: UNTYPED, category: 'veneer' as const, note: 'n' }],
  };
  assert.deepEqual(
    staleExceptions(lists, {
      misses: [{ addr: THUMB_TWO, name: 'thumb_two', size: 10, reason: 'unanchored', listed: true }],
      falseEntries: [{ addr: UNTYPED, origin: 'gap-scan', size: 4, listed: true }],
    }),
    [],
  );
  assert.deepEqual(staleExceptions(lists, { misses: [], falseEntries: [] }), [
    { list: 'labels', addr: THUMB_TWO },
    { list: 'untyped', addr: UNTYPED },
  ]);
});

test('dataset-check reports a stale untyped row as stale-exception and exits 1', async () => {
  const { code, report, lines } = await benchJson<{ ok: boolean; problems: Problem[] }>(
    'check-untyped',
    ['dataset-check'],
    tinyResult([0x0800_0010]),
  );
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, [{ dataset: 'tiny', list: 'untyped', addr: UNTYPED, problem: 'stale-exception' }]);
  assert.ok(
    lines.includes(`tiny: stale-exception: untyped: ${UNTYPED} is not reported any more; remove it from the list`),
    lines.join('\n'),
  );
});

test('dataset-check reports a stale labels row as stale-exception and exits 1', async () => {
  const label = { addr: THUMB_TWO, name: 'thumb_two', category: 'loop-label', note: 'injected' };
  const { code, report, lines } = await benchJson<{ ok: boolean; problems: Problem[] }>(
    'check-labels',
    ['dataset-check'],
    findsThumbTwo(),
    { labels: [label] },
  );
  assert.equal(code, 1);
  const stale = report.problems.filter((p) => p.problem === 'stale-exception');
  assert.deepEqual(stale, [{ dataset: 'tiny', list: 'labels', addr: THUMB_TWO, problem: 'stale-exception' }]);
  assert.ok(
    lines.includes(`tiny: stale-exception: labels: ${THUMB_TWO} is not missed any more; remove it from the list`),
    lines.join('\n'),
  );
});
