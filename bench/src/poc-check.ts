// `bench poc-check [--json]` (g1.bench-harness, architecture §13): per tuning ROM, rescoring the PoC's
// scored.json with score.ts reproduces bench/baseline/poc-2026-10-16.json field for field, the PoC's
// own fresh row equals the baseline too, its scaffold rebuilt the ROM, its two analyses have one
// digest, and the dump was made from the pinned PoC source.
import { readBaseline, jsonDiffs, withoutPaths, type JsonRecord } from './baseline.ts';
import type { BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { BenchError } from './files.ts';
import { readPinnedPocSource } from './poc-source.ts';
import { readDatasetInputs, rowOf } from './rescore.ts';
import type { BenchRow } from './row.ts';
import type { ScoredRun } from './scored-run.ts';

/** Row fields the rescored row is not compared on: volatile, judged later, or not produced by score.ts. */
export const ROW_EXCLUDED: readonly string[] = ['seconds', 'signatures', 'scaffold.summary', 'datasetProblems'];
/** The PoC's own row is compared on everything but its volatile seconds and the signatures (phase 6). */
export const POC_ROW_EXCLUDED: readonly string[] = ['seconds', 'signatures'];

export interface PocCheckRom {
  readonly name: string;
  readonly rowsEqual: boolean;
  readonly pocRowEqual: boolean;
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

/** The verdict of one ROM from its rescored row, its dump and its baseline row. */
export function checkPocRom(name: string, row: BenchRow, dump: ScoredRun, baseline: JsonRecord | undefined, pinnedDigest: string): PocCheckRom {
  if (baseline === undefined) {
    return { name, rowsEqual: false, pocRowEqual: false, diffs: [`no baseline row for ${name}`], scaffoldOk: dump.scaffold.ok, deterministic: dump.digests[0] === dump.digests[1], pocSourceDigestOk: dump.pocSourceDigest === pinnedDigest };
  }
  const rowDiffs = jsonDiffs(withoutPaths(baseline, ROW_EXCLUDED), withoutPaths(row as unknown as JsonRecord, ROW_EXCLUDED), '');
  const pocDiffs = jsonDiffs(withoutPaths(baseline, POC_ROW_EXCLUDED), withoutPaths(dump.pocRow, POC_ROW_EXCLUDED), '');
  return {
    name,
    rowsEqual: rowDiffs.length === 0,
    pocRowEqual: pocDiffs.length === 0,
    diffs: [...rowDiffs.map((d) => `row ${d}`), ...pocDiffs.map((d) => `pocRow ${d}`)],
    scaffoldOk: dump.scaffold.ok,
    deterministic: dump.digests[0] === dump.digests[1],
    pocSourceDigestOk: dump.pocSourceDigest === pinnedDigest,
  };
}

function unavailable(name: string, why: string): PocCheckRom {
  return { name, rowsEqual: false, pocRowEqual: false, diffs: [why], scaffoldOk: false, deterministic: false, pocSourceDigestOk: false };
}

export async function pocCheck(cx: BenchContext): Promise<PocCheckReport> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const baseline = await readBaseline(cx);
  const pinned = await readPinnedPocSource(cx);
  const roms: PocCheckRom[] = [];
  for (const d of tuningDatasets(datasets)) {
    try {
      const inputs = await readDatasetInputs(cx, d);
      const base = baseline.roms.find((r) => r['name'] === d.name);
      roms.push(checkPocRom(d.name, rowOf(inputs), inputs.dump, base, pinned.digest));
    } catch (error) {
      if (!(error instanceof BenchError)) throw error;
      roms.push(unavailable(d.name, error.message));
    }
  }
  return { ok: roms.length > 0 && roms.every(romPasses), roms };
}
