// `bench poc-check [--json]` (g1.bench-harness, architecture §13): per tuning ROM, rescoring the PoC's
// scored.json with score.ts reproduces bench/baseline/poc-2026-10-16.json field for field, the PoC's
// own fresh row equals the baseline too, its scaffold rebuilt the ROM, its two analyses have one
// digest and that digest is the one of the analysis the dump stores, and the dump was made from the
// pinned PoC source. The rescored row is compared without the `category` of its misses and false
// entries: categories describe the dataset, not the analysis (baseline-rows.ts), and milestone M5
// reclassified the rows the baseline still names `unreviewed` and `continuation-after-noreturn-call`.
// A tuning ROM that became tuning data by a reveal after the baseline was pinned (tmc, D60) has no
// baseline row: its rescored row is compared with the PoC's own fresh row of it instead (the harness
// still reproduces the PoC's scoring), and that row with the one pinned by content in
// bench/baseline/poc-dump-rows.json (`pinnedRow`: the dump made on the dataset of today, its row's digest
// the pinned one), so the PoC reference of such a ROM cannot drift unseen; its scaffold, determinism and
// pinned source are checked as for the others.
import { baselineRowOf, readBaseline, jsonDiffs, withoutPaths, type JsonRecord } from './baseline.ts';
import type { BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets, type Dataset } from './dataset.ts';
import { BenchError } from './files.ts';
import { dumpRowMismatch, POC_ROW_EXCLUDED, readPocDumpRows, type PocDumpRows } from './poc-dump-rows.ts';
import { readPinnedPocSource } from './poc-source.ts';
import { readDatasetInputs, rowOf } from './rescore.ts';
import type { BenchRow } from './row.ts';
import { analysisDigest, type ScoredRun } from './scored-run.ts';

/** Row fields the rescored row is not compared on: volatile, judged later, or not produced by score.ts. */
export const ROW_EXCLUDED: readonly string[] = ['seconds', 'signatures', 'scaffold.summary', 'datasetProblems'];
export { POC_ROW_EXCLUDED };

export interface PocCheckRom {
  readonly name: string;
  readonly rowsEqual: boolean;
  /** The PoC's fresh row equals the baseline row, or the pinned dump row; false and not asked when there is neither. */
  readonly pocRowEqual: boolean;
  /** Whether the pinned baseline holds a row of this ROM. */
  readonly baselineRow: boolean;
  /** Whether bench/baseline/poc-dump-rows.json pins the PoC's row of this ROM (a ROM revealed after the baseline). */
  readonly pinnedRow?: boolean;
  readonly diffs: readonly string[];
  readonly scaffoldOk: boolean;
  readonly deterministic: boolean;
  readonly pocSourceDigestOk: boolean;
}

export interface PocCheckReport {
  readonly ok: boolean;
  readonly roms: readonly PocCheckRom[];
}

export function romPasses(r: PocCheckRom): boolean {
  return r.rowsEqual && r.pocRowEqual && r.scaffoldOk && r.deterministic && r.pocSourceDigestOk;
}

/** Two runs with one digest, and that digest is the stored analysis's own. */
export function dumpDeterministic(dump: ScoredRun): boolean {
  return dump.digests[0] === dump.digests[1] && analysisDigest(dump.analysis) === dump.digests[0];
}

/** The row without the dataset's categories on its misses and false entries. */
export function withoutCategories(row: JsonRecord): JsonRecord {
  const strip = (list: unknown): unknown =>
    Array.isArray(list)
      ? list.map((item: unknown) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
          const { category: _category, ...rest } = item as Record<string, unknown>;
          return rest;
        })
      : list;
  return { ...row, misses: strip(row['misses']), falseEntries: strip(row['falseEntries']) } as JsonRecord;
}

/**
 * The verdict of one ROM from its rescored row, its dump and its baseline row. A ROM without a baseline
 * row passes only when it was revealed after the baseline was pinned (`revealed`): its rescored row is
 * compared with the dump's own PoC row, and that row with the pinned one (`pinned`, from
 * poc-dump-rows.ts dumpRowMismatch: undefined when it matches, else why not); any other ROM without one
 * fails.
 */
export function checkPocRom(
  name: string,
  row: BenchRow,
  dump: ScoredRun,
  baseline: JsonRecord | undefined,
  pinnedDigest: string,
  revealed = false,
  pinned: { readonly mismatch: string | undefined } = { mismatch: 'no pinned PoC row' },
): PocCheckRom {
  const deterministic = dumpDeterministic(dump);
  const rowRecord: JsonRecord = { ...row };
  const rescored = withoutCategories(withoutPaths(rowRecord, ROW_EXCLUDED));
  if (baseline === undefined) {
    const common = { name, baselineRow: false, scaffoldOk: dump.scaffold.ok, deterministic, pocSourceDigestOk: dump.pocSourceDigest === pinnedDigest };
    if (!revealed) return { ...common, pocRowEqual: false, rowsEqual: false, diffs: [`no baseline row for ${name}`] };
    const ownDiffs = jsonDiffs(withoutCategories(withoutPaths(dump.pocRow, ROW_EXCLUDED)), rescored, '');
    return {
      ...common,
      rowsEqual: ownDiffs.length === 0,
      pocRowEqual: pinned.mismatch === undefined,
      pinnedRow: true,
      diffs: [...ownDiffs.map((d) => `row (against the PoC's own row) ${d}`), ...(pinned.mismatch === undefined ? [] : [`pocRow ${pinned.mismatch}`])],
    };
  }
  const rowDiffs = jsonDiffs(withoutCategories(withoutPaths(baseline, ROW_EXCLUDED)), rescored, '');
  const pocDiffs = jsonDiffs(withoutPaths(baseline, POC_ROW_EXCLUDED), withoutPaths(dump.pocRow, POC_ROW_EXCLUDED), '');
  return {
    name,
    rowsEqual: rowDiffs.length === 0,
    pocRowEqual: pocDiffs.length === 0,
    baselineRow: true,
    diffs: [...rowDiffs.map((d) => `row ${d}`), ...pocDiffs.map((d) => `pocRow ${d}`)],
    scaffoldOk: dump.scaffold.ok,
    deterministic,
    pocSourceDigestOk: dump.pocSourceDigest === pinnedDigest,
  };
}

/** Why the dump of `d` is not its pinned PoC row (dumpRowMismatch), or undefined when it is. */
function pinnedMismatch(d: Dataset, dump: ScoredRun, rows: PocDumpRows | undefined): { readonly mismatch: string | undefined } {
  return { mismatch: dumpRowMismatch(d, rows, dump.pocSourceDigest, dump.datasetDigest, dump.pocRow) };
}

function unavailable(name: string, why: string): PocCheckRom {
  return { name, rowsEqual: false, pocRowEqual: false, baselineRow: false, diffs: [why], scaffoldOk: false, deterministic: false, pocSourceDigestOk: false };
}

export async function pocCheck(cx: BenchContext): Promise<PocCheckReport> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const baseline = await readBaseline(cx);
  const pinned = await readPinnedPocSource(cx);
  const rows = await readPocDumpRows(cx);
  const roms: PocCheckRom[] = [];
  for (const d of tuningDatasets(datasets)) {
    try {
      const inputs = await readDatasetInputs(cx, d);
      const base = baselineRowOf(baseline, d.name);
      roms.push(checkPocRom(d.name, rowOf(inputs), inputs.dump, base, pinned.digest, d.revealed.length > 0, pinnedMismatch(d, inputs.dump, rows)));
    } catch (error) {
      if (!(error instanceof BenchError)) throw error;
      roms.push(unavailable(d.name, error.message));
    }
  }
  return { ok: roms.length > 0 && roms.every(romPasses), roms };
}
