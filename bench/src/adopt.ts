// `bench adopt <rom>` (architecture §8.5, D25): seeds a new tuning dataset's exception lists from
// romlift's discover run of it. Every miss the lists lack becomes a `labels` row and every false entry
// an `untyped` row, each with category `unreviewed` and a note saying what the run reported, so
// g2.no-unreviewed holds the dataset until a person has classified every row (with bench explain). Rows
// already listed are kept as they are. A sealed dataset is refused (adoptRefusal): its lists stay empty
// until it is revealed. The command prints the `Bench-Exception:` trailers the commit adding the rows
// needs (bench regression).
import { join } from 'node:path';
import { compareCodeUnits } from 'romlift';

import { type AnalysisRunner, DEFAULT_RUN_TUNING, diagnosedRun, readRealInputs } from './analysis-run.ts';
import { type BenchContext, datasetDir } from './context.ts';
import { type Dataset, type LabelRow, type ListName, type UntypedRow, loadDatasets } from './dataset.ts';
import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';
import type { BenchRow } from './row.ts';
import { scoreAnalysis } from './score.ts';
import { adoptRefusal } from './seal.ts';
import { UNREVIEWED } from './vocabulary.ts';

export interface AdoptedLists {
  readonly labels: readonly LabelRow[];
  readonly untyped: readonly UntypedRow[];
  /** The rows added, in list then address order. */
  readonly added: readonly { readonly list: ListName; readonly addr: string }[];
}

/** The dataset's lists with every unlisted miss and false entry of `row` added as `unreviewed`. */
export function adoptLists(
  dataset: Pick<Dataset, 'labels' | 'untyped'>,
  row: Pick<BenchRow, 'misses' | 'falseEntries'>,
  commit: string,
): AdoptedLists {
  const newLabels: LabelRow[] = row.misses
    .filter((m) => !m.listed)
    .map((m) => ({
      addr: m.addr,
      name: m.name,
      category: UNREVIEWED,
      note: `adopted at ${commit}: missed (${m.reason}); classify with bench explain`,
    }));
  const newUntyped: UntypedRow[] = row.falseEntries
    .filter((f) => !f.listed)
    .map((f) => ({
      addr: f.addr,
      ...(f.owner === undefined ? {} : { name: f.owner }),
      category: UNREVIEWED,
      note: `adopted at ${commit}: reported via ${f.origin}, ${f.size} bytes; classify with bench explain`,
    }));
  const byAddr = (a: { readonly addr: string }, b: { readonly addr: string }): number =>
    compareCodeUnits(a.addr, b.addr);
  return {
    labels: [...dataset.labels, ...newLabels].sort(byAddr),
    untyped: [...dataset.untyped, ...newUntyped].sort(byAddr),
    added: [
      ...newLabels.map((r) => ({ list: 'labels' as const, addr: r.addr })),
      ...newUntyped.map((r) => ({ list: 'untyped' as const, addr: r.addr })),
    ],
  };
}

export interface AdoptOutcome {
  readonly file: string;
  readonly added: AdoptedLists['added'];
  /** One `Bench-Exception: <rom> <addr> <reason>` line per added row, for the commit message. */
  readonly trailers: readonly string[];
}

/** Adopts the run of dataset `name` into its lists and rewrites bench/dataset/real/<name>.json. */
export async function benchAdopt(
  cx: BenchContext,
  name: string,
  runner: AnalysisRunner,
  commit: string,
): Promise<AdoptOutcome> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const dataset = datasets.find((d) => d.name === name);
  if (dataset === undefined) throw new BenchError(`no dataset named ${name}`);
  const refusal = adoptRefusal(dataset);
  if (refusal !== undefined) throw new BenchError(refusal);
  const file = join(datasetDir(cx), `${name}.json`);
  if (!(await exists(file))) throw new BenchError(`the dataset ${name} is not in ${file}`);
  const raw = await readJson(file);
  if (!isRecord(raw)) throw new BenchError(`${file}: not a JSON object`);
  const inputs = await readRealInputs(cx, dataset);
  let run: ReturnType<typeof diagnosedRun>;
  try {
    run = diagnosedRun(inputs, runner, DEFAULT_RUN_TUNING);
  } catch (error) {
    throw new BenchError(`${name}: the analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const row = scoreAnalysis({ ...run, truth: inputs.truth, dataset, sha1: inputs.sha1, deterministic: true });
  const adopted = adoptLists(dataset, row, commit);
  await writeText(file, prettyJson({ ...raw, labels: adopted.labels, untyped: adopted.untyped }));
  return {
    file,
    added: adopted.added,
    trailers: adopted.added.map((a) => `Bench-Exception: ${name} ${a.addr} adopted ${a.list} row, unreviewed`),
  };
}
