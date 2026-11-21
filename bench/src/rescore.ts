// Scoring one tuning dataset from its PoC dump (poc-check, g1.bench-harness): reads the ROM and the
// ELF, refusing either when its digest differs from the dataset (D50), reads
// bench/.local/poc/<rom>/scored.json, and scores it. `bench run` scores romlift's own analysis instead
// (run.ts) and reads the dump only for the PoC's scaffold verdict (readScaffold).
import { type RealInputs, readRealInputs } from './analysis-run.ts';
import { type BenchContext, scoredPath } from './context.ts';
import type { Dataset } from './dataset.ts';
import { BenchError, exists, readJson } from './files.ts';
import type { BenchRow } from './row.ts';
import { scoreRun } from './score.ts';
import { type ScoredRun, parseScoredRun } from './scored-run.ts';

export interface DatasetInputs extends Omit<RealInputs, 'rom'> {
  readonly dump: ScoredRun;
}

/** The PoC dump of `d`, refused when it is the dump of another ROM; undefined when there is none. */
export async function readDump(cx: BenchContext, d: Dataset): Promise<ScoredRun | undefined> {
  const dumpPath = scoredPath(cx, d.name);
  if (!(await exists(dumpPath))) return undefined;
  const dump = parseScoredRun(await readJson(dumpPath), dumpPath);
  if (dump.rom !== d.name || dump.sha1 !== d.sha1)
    throw new BenchError(`${d.name}: ${dumpPath} is the dump of ${dump.rom} (${dump.sha1})`);
  return dump;
}

export async function readDatasetInputs(cx: BenchContext, d: Dataset): Promise<DatasetInputs> {
  const r = await readRealInputs(cx, d);
  const dump = await readDump(cx, d);
  if (dump === undefined)
    throw new BenchError(`${d.name}: ${scoredPath(cx, d.name)} is missing: run npm run export-poc -- --mode scored`);
  return { dataset: r.dataset, sha1: r.sha1, elfSha256: r.elfSha256, romSize: r.romSize, truth: r.truth, dump };
}

export function rowOf(inputs: DatasetInputs): BenchRow {
  return scoreRun({ dump: inputs.dump, truth: inputs.truth, dataset: inputs.dataset, sha1: inputs.sha1 });
}
