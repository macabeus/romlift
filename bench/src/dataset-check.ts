// `bench dataset-check [--json]` (g1.dataset-elf, architecture §8.3): the datasets against their ELFs.
// Every `labels` address must be an ELF FUNC inside a function the run found (inside a found extent,
// not itself an entry), every `untyped` address must not be a FUNC, and every listed row must still
// be needed by the run (a label it still misses, an untyped address it still reports), so the lists
// stay exact. Structural problems of the files are reported too.
import type { BenchContext } from './context.ts';
import { loadDatasets, rowAddr, tuningDatasets, type Dataset, type DatasetProblem } from './dataset.ts';
import { BenchError } from './files.ts';
import { readDatasetInputs, rowOf } from './rescore.ts';
import type { BenchRow } from './row.ts';
import { insideFoundFunction } from './score.ts';
import type { ScoredRun } from './scored-run.ts';
import type { Truth } from './truth.ts';

export interface DatasetCheckReport {
  readonly ok: boolean;
  readonly problems: readonly DatasetProblem[];
}

/** The ELF and staleness problems of one well-formed dataset against its run. */
export function checkDatasetAgainstRun(d: Dataset, truth: Truth, dump: ScoredRun, row: BenchRow): DatasetProblem[] {
  const problems: DatasetProblem[] = [];
  const missed = new Set(row.misses.map((m) => m.addr));
  const reported = new Set(row.falseEntries.map((f) => f.addr));
  for (const e of d.labels) {
    const a = rowAddr(e.addr);
    if (!truth.byAddr.has(a)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'not-a-func', detail: `labels: ${e.addr} is not a FUNC symbol in the ELF` });
    } else if (!insideFoundFunction(dump, a)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'not-inside-found-function', detail: `labels: ${e.addr} is not inside a found function` });
    }
    if (!missed.has(e.addr)) {
      problems.push({ dataset: d.name, list: 'labels', addr: e.addr, problem: 'stale-exception', detail: `labels: ${e.addr} is not missed any more; remove it from the list` });
    }
  }
  for (const e of d.untyped) {
    if (truth.byAddr.has(rowAddr(e.addr))) {
      problems.push({ dataset: d.name, list: 'untyped', addr: e.addr, problem: 'is-a-func', detail: `untyped: ${e.addr} is a FUNC symbol in the ELF` });
    }
    if (!reported.has(e.addr)) {
      problems.push({ dataset: d.name, list: 'untyped', addr: e.addr, problem: 'stale-exception', detail: `untyped: ${e.addr} is not reported any more; remove it from the list` });
    }
  }
  return problems;
}

export async function datasetCheck(cx: BenchContext): Promise<DatasetCheckReport> {
  const loaded = await loadDatasets(cx);
  const problems: DatasetProblem[] = [...loaded.problems];
  for (const d of tuningDatasets(loaded.datasets)) {
    try {
      const inputs = await readDatasetInputs(cx, d);
      problems.push(...checkDatasetAgainstRun(d, inputs.truth, inputs.dump, rowOf(inputs)));
    } catch (error) {
      if (!(error instanceof BenchError)) throw error;
      problems.push({ dataset: d.name, list: 'dataset', addr: '', problem: 'input-unavailable', detail: error.message });
    }
  }
  return { ok: problems.length === 0, problems };
}
