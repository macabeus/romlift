// `bench dataset-check [--json]` (g1.dataset-elf, a precondition of g2.entries, architecture §8.3): the
// datasets against their ELFs and against romlift's own discover run (D24). Every `labels` address must
// be an ELF FUNC inside a function the run found (inside a found extent, not itself an entry), every
// `untyped` address must not be a FUNC, and every listed row must still be needed by the run (a label it
// still misses, an untyped address it still reports), so the lists stay exact. Structural problems of
// the files are reported too, and the tuning set itself is pinned: the unsealed datasets must be exactly
// the ROMs of the PoC baseline (docs/benchmark-roms.md), so a tuning dataset flipped to `heldout`, or a
// held-out one unsealed, fails instead of shrinking the set. Sealed datasets are never run here.
import { DEFAULT_RUN_TUNING, diagnosedRun, readRealInputs, type AnalysisRunner } from './analysis-run.ts';
import { readBaseline } from './baseline.ts';
import type { BenchContext } from './context.ts';
import { loadDatasets, rowAddr, tuningDatasets, type Dataset, type DatasetProblem } from './dataset.ts';
import { BenchError } from './files.ts';
import type { BenchRow } from './row.ts';
import { analysisFunctions, insideFoundFunction, scoreAnalysis, staleExceptions, type FoundFunction } from './score.ts';
import type { Truth } from './truth.ts';

export interface DatasetCheckReport {
  readonly ok: boolean;
  readonly problems: readonly DatasetProblem[];
}

/** The ELF and staleness problems of one well-formed dataset against its run's found functions and row. */
export function checkDatasetAgainstRun(d: Dataset, truth: Truth, found: readonly Pick<FoundFunction, 'entry' | 'end'>[], row: Pick<BenchRow, 'misses' | 'falseEntries'>): DatasetProblem[] {
  const problems: DatasetProblem[] = [];
  const stale = new Set(staleExceptions(d, row).map((s) => `${s.list} ${s.addr}`));
  for (const e of d.labels) {
    const a = rowAddr(e.addr);
    if (!truth.byAddr.has(a)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'not-a-func', detail: `labels: ${e.addr} is not a FUNC symbol in the ELF` });
    } else if (!insideFoundFunction(found, a)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'not-inside-found-function', detail: `labels: ${e.addr} is not inside a found function` });
    }
    if (stale.has(`labels ${e.addr}`)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'stale-exception', detail: `labels: ${e.addr} is not missed any more; remove it from the list` });
    }
  }
  for (const e of d.untyped) {
    if (truth.byAddr.has(rowAddr(e.addr))) {
      problems.push({ dataset: d.name, list: 'untyped', addr: e.addr, problem: 'is-a-func', detail: `untyped: ${e.addr} is a FUNC symbol in the ELF` });
    }
    if (stale.has(`untyped ${e.addr}`)) {
      problems.push({ dataset: d.name, list: 'untyped', addr: e.addr, problem: 'stale-exception', detail: `untyped: ${e.addr} is not reported any more; remove it from the list` });
    }
  }
  return problems;
}

/** The problems of a tuning set that is not exactly `expected` (the baseline's ROM names). */
export function checkTuningSet(tuning: readonly Pick<Dataset, 'name'>[], expected: readonly string[]): DatasetProblem[] {
  const have = new Set(tuning.map((d) => d.name));
  const want = new Set(expected);
  const problems: DatasetProblem[] = [];
  for (const name of expected) {
    if (!have.has(name)) problems.push({ dataset: name, list: 'dataset', addr: '', problem: 'tuning-set', detail: `${name} is in the baseline's tuning set but no unsealed dataset has that name (flipped to heldout?)` });
  }
  for (const { name } of tuning) {
    if (!want.has(name)) problems.push({ dataset: name, list: 'dataset', addr: '', problem: 'tuning-set', detail: `${name} is an unsealed dataset but not in the baseline's tuning set` });
  }
  return problems;
}

/** The problems of one tuning dataset against romlift's run of its ROM. */
async function checkOne(cx: BenchContext, d: Dataset, runner: AnalysisRunner): Promise<DatasetProblem[]> {
  const inputs = await readRealInputs(cx, d);
  let run: ReturnType<typeof diagnosedRun>;
  try {
    run = diagnosedRun(inputs, runner, DEFAULT_RUN_TUNING);
  } catch (error) {
    return [{ dataset: d.name, list: 'dataset', addr: '', problem: 'input-unavailable', detail: `the analysis failed: ${error instanceof Error ? error.message : String(error)}` }];
  }
  const row = scoreAnalysis({ ...run, truth: inputs.truth, dataset: d, sha1: inputs.sha1, deterministic: true });
  return checkDatasetAgainstRun(d, inputs.truth, analysisFunctions(run.result), row);
}

export async function datasetCheck(cx: BenchContext, runner: AnalysisRunner): Promise<DatasetCheckReport> {
  const loaded = await loadDatasets(cx);
  const problems: DatasetProblem[] = [...loaded.problems];
  const baseline = await readBaseline(cx);
  // A dataset whose file does not parse is reported for that already, not as missing from the set.
  const unparsed = new Set(loaded.problems.map((p) => p.dataset));
  const expected = baseline.roms.map((r) => String(r['name'])).filter((name) => !unparsed.has(name));
  problems.push(...checkTuningSet(tuningDatasets(loaded.datasets).filter((d) => !unparsed.has(d.name)), expected));
  for (const d of tuningDatasets(loaded.datasets)) {
    try {
      problems.push(...(await checkOne(cx, d, runner)));
    } catch (error) {
      if (!(error instanceof BenchError)) throw error;
      problems.push({ dataset: d.name, list: 'dataset', addr: '', problem: 'input-unavailable', detail: error.message });
    }
  }
  return { ok: problems.length === 0, problems };
}
