// `npm run export-poc -- --mode scored|parity|queries [--only <rom>]` (architecture §4.5, D11, D48,
// D50): runs the read-only PoC from ROMLIFT_POC with its own tsx (bench/tools/export-poc-child.ts),
// once per tuning dataset (never a sealed one), and writes what it found to the gitignored
// bench/.local/poc/<rom>/:
//
//   scored   scored.json, in the frozen ScoredRun shape (phase 1); a dump made on romlift's dataset (a ROM
//            the PoC has no dataset file of, D60) is checked against bench/baseline/poc-dump-rows.json,
//            which `--pin` writes instead;
//   parity   parity.json, the parity view (bench/src/parity-view.ts), after two PoC processes have
//            produced the same digest; then bench/baseline/poc-digests.json, the digest per ROM;
//   queries  queries.ndjson and readings.ndjson, the lockstep log (bench/src/poc-log.ts), after
//            checking that the instrumented run's parity digest is the committed one, and re-reading
//            the whole log through the validating reader.
//
// It refuses a PoC checkout whose files differ from bench/baseline/poc-source.json and a ROM whose
// SHA-1 differs from its dataset.
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareCodeUnits } from 'romlift';
import { sha1Of } from 'romlift/node';

import { parseArgs, UsageError } from '../src/args.ts';
import { jsonDiffs, pocRomNames, readBaseline, stripSeconds } from '../src/baseline.ts';
import { contextFromEnv, scoredPath, type BenchContext } from '../src/context.ts';
import { loadDatasets, pocDatasets, tuningDatasets, type Dataset } from '../src/dataset.ts';
import { BenchError, exists, isRecord, prettyJson, readFileBytes, readJson, writeText } from '../src/files.ts';
import {
  parityDigest,
  parityPath,
  parityText,
  parseParityView,
  parsePocDigests,
  pocDigestsPath,
  POC_DIGESTS_SCHEMA,
  type ParityView,
  type PocDigests,
} from '../src/parity-view.ts';
import { openPocLog, queriesPath } from '../src/poc-log.ts';
import { comparePocSource, computePocSource, readPinnedPocSource } from '../src/poc-source.ts';
import { runProcess } from '../src/process.ts';
import { analysisDigest, parseScoredRun, SCORED_SCHEMA, type ScoredRun } from '../src/scored-run.ts';
import {
  dumpRowMismatch,
  pocDatasetDigest,
  pocDatasetOf,
  pocDumpRowsPath,
  pocDumpRowsText,
  pocRowDigest,
  POC_DUMP_ROWS_SCHEMA,
  readPocDumpRows,
  type PinnedDumpRow,
} from '../src/poc-dump-rows.ts';

const USAGE = 'usage: npm run export-poc -- --mode scored|parity|queries [--only <rom>] [--pin]';
const CHILD = fileURLToPath(new URL('./export-poc-child.ts', import.meta.url));

export const EXPORT_MODES = ['scored', 'parity', 'queries'] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];

export function isExportMode(value: string | undefined): value is ExportMode {
  return (EXPORT_MODES as readonly (string | undefined)[]).includes(value);
}

// ---------------------------------------------------------------- pure post-processing

/** Builds the frozen scored.json value from the child's document; throws when the document is not as expected. */
export function scoredFromChild(doc: unknown, rom: string, sha1: string, pocSourceDigest: string, datasetDigest: string | null = null): ScoredRun {
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
    datasetDigest: doc['dataset'] === 'given' ? datasetDigest : null,
    analysis: first,
    misses: doc['misses'],
    digests: [analysisDigest(first), analysisDigest(second)],
    scaffold: { ok: scaffold['ok'], summary: scaffold['summary'] },
    pocRow: stripSeconds(row),
  };
  return parseScoredRun(value, `${rom}: the PoC child's document`);
}

/** One parity run of the child: the view it printed and how long the analysis took. */
export interface ParityRun {
  readonly view: ParityView;
  readonly seconds: number;
}

function seconds(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new BenchError(`${where}: expected a number of seconds`);
  return value;
}

/** Reads the child's `--mode parity` document, {parity, seconds}. */
export function parityFromChild(doc: unknown, rom: string): ParityRun {
  if (!isRecord(doc)) throw new BenchError(`${rom}: the PoC child printed no {parity, seconds} document`);
  return { view: parseParityView(doc['parity'], `${rom}: parity`), seconds: seconds(doc['seconds'], `${rom}: seconds`) };
}

/** The digest of a ROM's view when two PoC runs agree; a BenchError naming the first differences otherwise. */
export function deterministicDigest(rom: string, first: ParityView, second: ParityView): string {
  const a = parityDigest(first);
  const b = parityDigest(second);
  if (a !== b) {
    const diffs = jsonDiffs(first, second, '', 5).join('; ');
    throw new BenchError(`${rom}: the PoC is not deterministic: two runs have parity digests ${a} and ${b} (${diffs}); nothing written`);
  }
  return a;
}

/**
 * The poc-digests.json value: `digests` over the ROMs of `previous` when it pins the same PoC checkout
 * (an `--only` run keeps the other ROMs), keys sorted.
 */
export function pocDigestsDocument(pocSourceDigest: string, digests: Readonly<Record<string, string>>, previous?: PocDigests): PocDigests {
  const merged: Record<string, string> = previous?.pocSourceDigest === pocSourceDigest ? { ...previous.roms, ...digests } : { ...digests };
  const roms: Record<string, string> = {};
  for (const name of Object.keys(merged).sort(compareCodeUnits)) roms[name] = merged[name] ?? '';
  return parsePocDigests({ pocSourceDigest, roms, schema: POC_DIGESTS_SCHEMA }, 'poc-digests');
}

/** The committed spelling of poc-digests.json: two-space JSON, every key sorted. */
export function pocDigestsText(doc: PocDigests): string {
  return prettyJson({ pocSourceDigest: doc.pocSourceDigest, roms: doc.roms, schema: doc.schema });
}

/** What the child's `--mode queries` run printed. */
export interface QueriesRun extends ParityRun {
  readonly queries: number;
  readonly readings: number;
  readonly queryBytes: number;
  readonly readingBytes: number;
}

function count(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new BenchError(`${where}: expected a count`);
  return value;
}

export function queriesFromChild(doc: unknown, rom: string): QueriesRun {
  const run = parityFromChild(doc, rom);
  const d = doc as Record<string, unknown>;
  return {
    ...run,
    queries: count(d['queries'], `${rom}: queries`),
    readings: count(d['readings'], `${rom}: readings`),
    queryBytes: count(d['queryBytes'], `${rom}: queryBytes`),
    readingBytes: count(d['readingBytes'], `${rom}: readingBytes`),
  };
}

/** Refuses a queries run whose parity digest is not the committed one: the log would describe another run. */
export function checkCommittedDigest(rom: string, digest: string, committed: PocDigests, pocSourceDigest: string): void {
  if (committed.pocSourceDigest !== pocSourceDigest) {
    throw new BenchError(`${rom}: bench/baseline/poc-digests.json pins another PoC checkout; run --mode parity first`);
  }
  const want = committed.roms[rom];
  if (want === undefined) throw new BenchError(`${rom}: bench/baseline/poc-digests.json has no digest for it; run --mode parity first`);
  if (want !== digest) throw new BenchError(`${rom}: the instrumented run has parity digest ${digest}, the committed one is ${want}`);
}

// ---------------------------------------------------------------- running the child

async function checkedRom(cx: BenchContext, d: Dataset): Promise<string> {
  const bytes = await readFileBytes(join(cx.benchRoot, d.rom));
  const sha1 = sha1Of(bytes);
  if (sha1 !== d.sha1) throw new BenchError(`${d.name}: ${d.rom} has SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  return sha1;
}

/** Runs the child for one dataset and returns the JSON document on its last stdout line. */
async function runChild(cx: BenchContext, d: Dataset, args: readonly string[]): Promise<unknown> {
  const tsx = join(cx.pocRoot, 'node_modules', '.bin', 'tsx');
  if (!(await exists(tsx))) throw new BenchError(`${tsx} is missing: the PoC checkout has no node_modules`);
  // Run outside both repositories; the PoC scaffolds into os.tmpdir()/romlift-bench/<name> itself.
  const cwd = join(tmpdir(), 'romlift-bench');
  await mkdir(cwd, { recursive: true });
  const run = await runProcess(tsx, [CHILD, d.name, ...args], {
    cwd,
    env: {
      ROMLIFT_BENCH_ROOT: cx.benchRoot,
      ROMLIFT_POC: cx.pocRoot,
      // For a tuning ROM the pinned PoC has no dataset file of (tmc, D60): the child uses the PoC's own file when it has one.
      ROMLIFT_POC_DATASET: JSON.stringify(pocDatasetOf(d)),
      ROMLIFT_TABLES: undefined,
      ROMLIFT_ARMSCAN: undefined,
      ROMLIFT_TRACE: undefined,
    },
    echoStderr: true,
  });
  if (run.code !== 0) throw new BenchError(`${d.name}: the PoC child exited ${run.code}`);
  const last = run.stdout.split('\n').filter((line) => line.trim() !== '').pop();
  if (last === undefined) throw new BenchError(`${d.name}: the PoC child printed nothing`);
  try {
    return JSON.parse(last) as unknown;
  } catch {
    throw new BenchError(`${d.name}: the PoC child's last line is not JSON`);
  }
}

async function exportScored(cx: BenchContext, d: Dataset, pocSourceDigest: string): Promise<ScoredRun> {
  const sha1 = await checkedRom(cx, d);
  const scored = scoredFromChild(await runChild(cx, d, ['scored']), d.name, sha1, pocSourceDigest, pocDatasetDigest(d));
  await writeText(scoredPath(cx, d.name), `${JSON.stringify(scored)}\n`);
  const same = scored.digests[0] === scored.digests[1];
  process.stdout.write(
    `${d.name.padEnd(12)} ${scored.analysis.functions.length} functions, ${scored.misses.length} misses, ` +
      `scaffold ${scored.scaffold.ok ? 'OK' : 'FAILED'}, ${same ? 'deterministic' : 'NOT DETERMINISTIC'}` +
      `${scored.datasetDigest === null ? '' : `, on romlift's dataset ${scored.datasetDigest.slice(0, 12)}…`} -> ${scoredPath(cx, d.name)}\n`,
  );
  return scored;
}

/**
 * The pinned PoC rows after a scored export: each dump made on romlift's dataset is checked against
 * bench/baseline/poc-dump-rows.json, or, with `pin`, written into it (the diff in Git is the review).
 */
async function checkOrPinDumpRows(cx: BenchContext, runs: readonly { readonly d: Dataset; readonly scored: ScoredRun }[], pocSourceDigest: string, pin: boolean): Promise<void> {
  const committed = await readPocDumpRows(cx);
  const roms: Record<string, PinnedDumpRow> = { ...(committed?.pocSourceDigest === pocSourceDigest ? committed.roms : {}) };
  const problems: string[] = [];
  for (const { d, scored } of runs) {
    if (scored.datasetDigest === null) continue;
    if (pin) {
      const tp = scored.pocRow['tp'];
      roms[d.name] = { datasetDigest: scored.datasetDigest, rowDigest: pocRowDigest(scored.pocRow), tp: typeof tp === 'number' ? tp : 0 };
      continue;
    }
    const why = dumpRowMismatch(d, committed, scored.pocSourceDigest, scored.datasetDigest, scored.pocRow);
    if (why !== undefined) problems.push(why);
    else process.stdout.write(`${d.name.padEnd(12)} the PoC's row equals the one pinned in ${pocDumpRowsPath(cx)}\n`);
  }
  if (pin) {
    await writeText(pocDumpRowsPath(cx), pocDumpRowsText({ schema: POC_DUMP_ROWS_SCHEMA, pocSourceDigest, roms }));
    process.stdout.write(`${Object.keys(roms).length} pinned PoC rows -> ${pocDumpRowsPath(cx)}\n`);
  }
  if (problems.length > 0) throw new BenchError(`the PoC's rows differ from the pinned ones (re-pin with --pin only after reviewing why):\n${problems.join('\n')}`);
}

/** Two PoC processes per ROM; parity.json is written only when their digests agree. Returns the digest. */
async function exportParity(cx: BenchContext, d: Dataset): Promise<string> {
  await checkedRom(cx, d);
  const first = parityFromChild(await runChild(cx, d, ['parity']), d.name);
  const second = parityFromChild(await runChild(cx, d, ['parity']), d.name);
  const digest = deterministicDigest(d.name, first.view, second.view);
  await writeText(parityPath(cx, d.name), parityText(first.view));
  process.stdout.write(
    `${d.name.padEnd(12)} ${first.view.functions.length} functions, ${first.view.claims.length} claim runs, ` +
      `analysis ${first.seconds.toFixed(1)} s / ${second.seconds.toFixed(1)} s, deterministic, parity ${digest} -> ${parityPath(cx, d.name)}\n`,
  );
  return digest;
}

const mib = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MiB`;

async function exportQueries(cx: BenchContext, d: Dataset, pocSourceDigest: string, committed: PocDigests): Promise<void> {
  const sha1 = await checkedRom(cx, d);
  const path = queriesPath(cx, d.name);
  const run = queriesFromChild(await runChild(cx, d, ['queries', dirname(path), sha1, pocSourceDigest]), d.name);
  checkCommittedDigest(d.name, parityDigest(run.view), committed, pocSourceDigest);
  // Re-read the whole log through the validating reader: the archived log is well formed.
  const started = process.hrtime.bigint();
  const log = await openPocLog(path);
  let records = 0;
  for await (const query of log.queries) records = query.seq + 1;
  const readSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  if (log.header.rom !== d.name || log.header.sha1 !== sha1 || log.header.pocSourceDigest !== pocSourceDigest) {
    throw new BenchError(`${path}: its header names another ROM or PoC checkout`);
  }
  if (records !== run.queries || log.readings.size !== run.readings) {
    throw new BenchError(`${path}: holds ${records} queries and ${log.readings.size} readings, the child wrote ${run.queries} and ${run.readings}`);
  }
  process.stdout.write(
    `${d.name.padEnd(12)} ${run.view.functions.length} functions, ${run.queries} queries (${mib(run.queryBytes)}), ` +
      `${run.readings} readings (${mib(run.readingBytes)}), run ${run.seconds.toFixed(1)} s, re-read ${readSeconds.toFixed(1)} s, ` +
      `parity matches the committed digest -> ${path}\n`,
  );
}

async function readCommittedDigests(cx: BenchContext): Promise<PocDigests | undefined> {
  const path = pocDigestsPath(cx);
  if (!(await exists(path))) return undefined;
  return parsePocDigests(await readJson(path), path);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['mode', 'only'], flags: ['pin'] });
  const mode = args.options['mode'];
  if (!isExportMode(mode)) throw new UsageError(`--mode must be scored, parity or queries\n${USAGE}`);
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
  // scored: every tuning dataset (the PoC's scaffold measures the scaffold family until phase 3, and its
  // own row is the PoC reference of a ROM its baseline does not name, D60); parity and queries: the ROMs
  // of the PoC baseline, whose digests and logs are committed evidence.
  const chosen = mode === 'scored' ? tuningDatasets(datasets, only) : pocDatasets(datasets, pocRomNames(await readBaseline(cx)), only);
  if (chosen.length === 0) throw new BenchError(only === undefined ? 'no tuning datasets the PoC ran on' : `no tuning dataset named ${only} that the PoC ran on`);
  if (mode === 'scored') {
    const runs: { readonly d: Dataset; readonly scored: ScoredRun }[] = [];
    for (const d of chosen) runs.push({ d, scored: await exportScored(cx, d, pinned.digest) });
    await checkOrPinDumpRows(cx, runs, pinned.digest, args.flags.has('pin'));
  } else if (mode === 'parity') {
    const digests: Record<string, string> = {};
    for (const d of chosen) digests[d.name] = await exportParity(cx, d);
    const doc = pocDigestsDocument(pinned.digest, digests, await readCommittedDigests(cx));
    await writeText(pocDigestsPath(cx), pocDigestsText(doc));
    process.stdout.write(`${Object.keys(doc.roms).length} parity digests -> ${pocDigestsPath(cx)}\n`);
  } else {
    const committed = await readCommittedDigests(cx);
    if (committed === undefined) throw new BenchError(`${pocDigestsPath(cx)} is missing; run --mode parity first`);
    for (const d of chosen) await exportQueries(cx, d, pinned.digest, committed);
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
