// `npm run export-poc -- --mode scored [--only <rom>]` (architecture §4.5): runs the read-only PoC
// from ROMLIFT_POC with its own tsx, once per tuning dataset, and writes what it found to the
// gitignored bench/.local/poc/<rom>/scored.json in the frozen ScoredRun shape. It refuses a PoC
// checkout whose files differ from bench/baseline/poc-source.json and a ROM whose SHA-1 differs from
// its dataset. Phase 1 has the `scored` mode only (`parity` and `queries` land in phase 2).
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, type JsonValue } from 'romlift';
import { sha1Of, sha256Stream } from 'romlift/node';

import { parseArgs, UsageError } from '../src/args.ts';
import { stripSeconds } from '../src/baseline.ts';
import { contextFromEnv, scoredPath, type BenchContext } from '../src/context.ts';
import { loadDatasets, tuningDatasets, type Dataset } from '../src/dataset.ts';
import { BenchError, exists, isRecord, readFileBytes, writeText } from '../src/files.ts';
import { comparePocSource, computePocSource, readPinnedPocSource } from '../src/poc-source.ts';
import { runProcess } from '../src/process.ts';
import { parseScoredRun, SCORED_SCHEMA, type ScoredRun } from '../src/scored-run.ts';

const USAGE = 'usage: npm run export-poc -- --mode scored [--only <rom>]';
const CHILD = fileURLToPath(new URL('./export-poc-child.ts', import.meta.url));

/** The digest of one analysis: sha256 of its canonical JSON. */
export function analysisDigest(analysis: unknown): string {
  return sha256Stream(canonicalJson(analysis as JsonValue));
}

/** Builds the frozen scored.json value from the child's document; throws when the document is not as expected. */
export function scoredFromChild(doc: unknown, rom: string, sha1: string, pocSourceDigest: string): ScoredRun {
  if (!isRecord(doc) || !Array.isArray(doc['analyses']) || doc['analyses'].length !== 2 || !isRecord(doc['row'])) {
    throw new BenchError(`${rom}: the PoC child printed no {analyses: [2], misses, row} document`);
  }
  const row = doc['row'];
  const scaffold = row['scaffold'];
  if (!isRecord(scaffold)) throw new BenchError(`${rom}: the PoC row has no scaffold verdict`);
  const [first, second] = doc['analyses'] as unknown[];
  const value = {
    schema: SCORED_SCHEMA,
    rom,
    sha1,
    pocSourceDigest,
    analysis: first,
    misses: doc['misses'],
    digests: [analysisDigest(first), analysisDigest(second)],
    scaffold: { ok: scaffold['ok'], summary: scaffold['summary'] },
    pocRow: stripSeconds(row),
  };
  return parseScoredRun(value, `${rom}: the PoC child's document`);
}

async function exportOne(cx: BenchContext, d: Dataset, pocSourceDigest: string): Promise<ScoredRun> {
  const bytes = await readFileBytes(join(cx.benchRoot, d.rom));
  const sha1 = sha1Of(bytes);
  if (sha1 !== d.sha1) throw new BenchError(`${d.name}: ${d.rom} has SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  const tsx = join(cx.pocRoot, 'node_modules', '.bin', 'tsx');
  if (!(await exists(tsx))) throw new BenchError(`${tsx} is missing: the PoC checkout has no node_modules`);
  // Run outside both repositories; the PoC scaffolds into os.tmpdir()/romlift-bench/<name> itself.
  const cwd = join(tmpdir(), 'romlift-bench');
  await mkdir(cwd, { recursive: true });
  const run = await runProcess(tsx, [CHILD, d.name], {
    cwd,
    env: { ROMLIFT_BENCH_ROOT: cx.benchRoot, ROMLIFT_POC: cx.pocRoot },
    echoStderr: true,
  });
  if (run.code !== 0) throw new BenchError(`${d.name}: the PoC child exited ${run.code}`);
  const last = run.stdout.split('\n').filter((line) => line.trim() !== '').pop();
  if (last === undefined) throw new BenchError(`${d.name}: the PoC child printed nothing`);
  const scored = scoredFromChild(JSON.parse(last) as unknown, d.name, sha1, pocSourceDigest);
  await writeText(scoredPath(cx, d.name), `${JSON.stringify(scored)}\n`);
  return scored;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['mode', 'only'] });
  if (args.options['mode'] !== 'scored') throw new UsageError(`--mode must be 'scored' in phase 1\n${USAGE}`);
  const cx = contextFromEnv(process.env);
  const pinned = await readPinnedPocSource(cx);
  const actual = await computePocSource(cx.pocRoot);
  const problems = comparePocSource(pinned, actual);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    throw new BenchError(`refusing to run: the PoC checkout at ${cx.pocRoot} is not the pinned one (bench/baseline/poc-source.json)`);
  }
  const { datasets, problems: datasetProblems } = await loadDatasets(cx);
  if (datasetProblems.length > 0) throw new BenchError(`malformed datasets: ${datasetProblems.map((p) => p.detail).join('; ')}`);
  const only = args.options['only'];
  const chosen = tuningDatasets(datasets, only);
  if (chosen.length === 0) throw new BenchError(only === undefined ? 'no tuning datasets' : `no tuning dataset named ${only}`);
  for (const d of chosen) {
    const scored = await exportOne(cx, d, pinned.digest);
    const same = scored.digests[0] === scored.digests[1];
    process.stdout.write(
      `${d.name.padEnd(12)} ${scored.analysis.functions.length} functions, ${scored.misses.length} misses, ` +
        `scaffold ${scored.scaffold.ok ? 'OK' : 'FAILED'}, ${same ? 'deterministic' : 'NOT DETERMINISTIC'} -> ${scoredPath(cx, d.name)}\n`,
    );
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(error instanceof UsageError ? 2 : 1);
    },
  );
}
