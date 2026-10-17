// `bench run [--only <rom>] [--json] [--disable <rule>...] [--cpu-prof]
// [--reveal <rom> --reason <text>]` (architecture §8.2–8.5, D24, D25, D41, D43): scores romlift's own
// seedless discover run of every tuning dataset against its ELF (analysis-run.ts, score.ts) and the PoC
// baseline (baseline-rows.ts, accepted-diffs.ts), and runs the sealed held-out datasets through the
// classifiers, keeping counts only (seal.ts, classify.ts).
//
//   --json   prints one last line {schema: 'romlift/bench-run@1', roms, sealed, failed} and writes no
//            committed file (bench/timings.json only). Without --only it runs the tuning datasets.
//   default  the phase lead's run: the tuning datasets and every sealed one, written to bench/results.json
//            (meta.source 'romlift', the families each ROM measured, the gate record kept only while its
//            sources and inputs are unchanged, the previous `parity` evidence kept) and bench/timings.json;
//            held-out ROMs are stored as counts and verdicts only.
//   --only   one dataset; a sealed one runs sealed and prints its counts only, writing nothing.
//   --reveal appends {at, commit, reason} to a held-out dataset's `revealed` log, which makes it tuning
//            data, and prints its rows to stdout; rows are never written to results.json (D25).
//
// Each row carries `parity: {digest, expected}`: the parity-view digest of the run (bench/src/parity.ts)
// and the PoC's committed one (bench/baseline/poc-digests.json). The PoC-parity evidence of milestone M1,
// the `parity` member of results.json (parity-evidence.ts), was recorded by a run under the PoC's LIFO
// worklist before 'poc-lifo' was deleted; every lead run keeps it unchanged.
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { compareCodeUnits, hexAddr } from 'romlift';

import { acceptedFor, readAcceptedDiffs, type AcceptedDiffs } from './accepted-diffs.ts';
import { analyzeDataset, analysisTuning, benchProfile, discoverOptions, isDefaultTuning, readRealInputs, sealedInput, type AnalysisRunner, type DatasetAnalysis, type RealInputs, type RunTuning, DEFAULT_RUN_TUNING } from './analysis-run.ts';
import { readResultsFile, writeResultsFile, type GateEntry, type Results, type ResultsMeta, type RomInputs, type SealedEntry, type Toolchain } from './artifact.ts';
import { readBaseline, type Baseline } from './baseline.ts';
import { compareWithBaseline, parseBaselineRow } from './baseline-rows.ts';
import { datasetDir, resultsPath, timingsPath, type BenchContext } from './context.ts';
import { cpuProfPath, profiled, writeTopSelfTime } from './cpu-prof.ts';
import { isSealed, loadDatasets, type Dataset } from './dataset.ts';
import { currentNodeMajor, sourceDigest } from './digest.ts';
import { phase2RomFamilies } from './families.ts';
import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';
import { gitDirty, gitHead } from './git.ts';
import { resultParityDigest } from './parity.ts';
import { parsePocDigests, pocDigestsPath, type PocDigests } from './parity-view.ts';
import { readPinnedPocSource } from './poc-source.ts';
import { printerMember } from './printer.ts';
import { readDump } from './rescore.ts';
import type { RomliftRow } from './row.ts';
import { analysisFunctions, scoreAnalysis, staleExceptions } from './score.ts';
import { appendReveal, assertCountsOnly, sealedCounts, sealedPasses } from './seal.ts';
import { readSpeedBaseline } from './speed.ts';
import { toolchainVersions } from './toolchain.ts';

export const BENCH_RUN_SCHEMA = 'romlift/bench-run@1';

/** A dataset whose analysis threw; a sealed dataset's detail is withheld. */
export interface RunFailure {
  readonly name: string;
  readonly detail: string;
}

/** The --json line (frozen by the headers of test/gates/g2.*.test.ts). */
export interface BenchRunReport {
  readonly schema: typeof BENCH_RUN_SCHEMA;
  readonly roms: readonly RomliftRow[];
  readonly sealed: readonly SealedEntry[];
  readonly failed: readonly RunFailure[];
}

export interface RunOptions {
  readonly only?: string;
  /** --json: print the report, write no committed file. */
  readonly json?: boolean;
  readonly tuning?: RunTuning;
  readonly cpuProf?: boolean;
  readonly runner: AnalysisRunner;
  readonly log?: (line: string) => void;
}

export interface RunOutcome {
  readonly report: BenchRunReport;
  /** The artifact written, when the run wrote bench/results.json. */
  readonly results?: Results;
  readonly gatesKept: boolean;
}

export async function romliftVersion(repoRoot: string): Promise<string> {
  const pkg = await readJson(join(repoRoot, 'package.json'));
  return isRecord(pkg) && typeof pkg['version'] === 'string' ? pkg['version'] : '';
}

/** The previous gate record survives only if it was judged on the same sources and inputs. */
export function keptGates(previous: Results | undefined, meta: Pick<ResultsMeta, 'sourceDigest' | 'inputs'>): readonly GateEntry[] {
  if (previous === undefined) return [];
  if (previous.meta.sourceDigest !== meta.sourceDigest || !isDeepStrictEqual(previous.meta.inputs, meta.inputs)) return [];
  return previous.gates.real;
}

/** What scoring a tuning dataset reads besides its run: the PoC baseline, the accepted improvements, the pinned PoC source. */
export interface TuningContext {
  readonly baseline: Baseline;
  readonly accepted: AcceptedDiffs;
  readonly pinnedPocDigest: string;
  /** bench/baseline/poc-digests.json, when committed. */
  readonly pocDigests?: PocDigests;
}

export async function tuningContext(cx: BenchContext): Promise<TuningContext> {
  const digestsPath = pocDigestsPath(cx);
  const pocDigests = (await exists(digestsPath)) ? parsePocDigests(await readJson(digestsPath), digestsPath) : undefined;
  return {
    baseline: await readBaseline(cx),
    accepted: await readAcceptedDiffs(cx),
    pinnedPocDigest: (await readPinnedPocSource(cx)).digest,
    ...(pocDigests === undefined ? {} : { pocDigests }),
  };
}


/** The PoC's scaffold verdict for `d`, from its dump (until phase 3); refused when the dump is of another PoC source. */
async function scaffoldOf(cx: BenchContext, d: Dataset, pinned: string): Promise<{ readonly ok: boolean } | undefined> {
  const dump = await readDump(cx, d);
  if (dump === undefined) return undefined;
  if (dump.pocSourceDigest !== pinned) throw new BenchError(`${d.name}: the dump was made from PoC source ${dump.pocSourceDigest}, not the pinned ${pinned}: re-run export-poc`);
  return { ok: dump.scaffold.ok };
}

/** The full row of one tuning dataset from its analysis. */
export function romliftRow(inputs: RealInputs, analysis: DatasetAnalysis, tc: TuningContext, scaffold: { readonly ok: boolean } | undefined): RomliftRow {
  const d = inputs.dataset;
  const row = scoreAnalysis({
    result: analysis.result,
    diagnoses: analysis.diagnoses,
    truth: inputs.truth,
    dataset: d,
    sha1: inputs.sha1,
    deterministic: analysis.deterministic,
    ...(scaffold === undefined ? {} : { scaffold }),
  });
  const record = tc.baseline.roms.find((r) => r['name'] === d.name);
  const found = new Set(analysisFunctions(analysis.result).map((f) => hexAddr(f.entry)));
  const comparison =
    record === undefined
      ? { poc: { tp: 0 }, lost: [], baselineRows: { diffs: [], unaccepted: [], staleAccepted: [] } }
      : compareWithBaseline(parseBaselineRow(record, 'bench/baseline/poc-2026-10-16.json'), row, found, acceptedFor(tc.accepted, d.name));
  return {
    ...row,
    extents: { ...row.extents, lost: comparison.lost },
    analysisDigest: analysis.digests[0],
    poc: comparison.poc,
    staleExceptions: staleExceptions(d, row),
    baselineRows: comparison.baselineRows,
    parity: { digest: resultParityDigest(analysis.result), expected: tc.pocDigests?.roms[d.name] ?? '' },
  };
}

/** One tuning dataset analysed (profiled with --cpu-prof), scored and compared. */
async function runTuning(cx: BenchContext, d: Dataset, tc: TuningContext, options: RunOptions, tuning: RunTuning): Promise<{ readonly row: RomliftRow; readonly inputs: RealInputs; readonly analysis: DatasetAnalysis; readonly scaffold: boolean }> {
  const inputs = await readRealInputs(cx, d);
  const scaffold = await scaffoldOf(cx, d, tc.pinnedPocDigest);
  let analysis: DatasetAnalysis;
  if (options.cpuProf === true) {
    const { value, profile } = await profiled(() => analyzeDataset(inputs, options.runner, tuning));
    analysis = value;
    await writeTopSelfTime(cx, d.name, profile);
    options.log?.(`${d.name}: top self-time functions in ${cpuProfPath(cx, d.name)}`);
  } else {
    analysis = analyzeDataset(inputs, options.runner, tuning);
  }
  return { row: romliftRow(inputs, analysis, tc, scaffold), inputs, analysis, scaffold: scaffold !== undefined };
}

/** One sealed dataset: a single run, classified; counts and verdict only. */
function sealedEntry(inputs: RealInputs, options: RunOptions, tuning: RunTuning): SealedEntry {
  const profile = benchProfile();
  const result = options.runner.analyze(inputs.rom, profile, discoverOptions(), analysisTuning(tuning));
  const counts = sealedCounts(sealedInput(inputs.dataset.name, inputs, result, profile));
  assertCountsOnly(counts);
  const entry: SealedEntry = { ...counts, pass: sealedPasses(counts).pass };
  assertCountsOnly(entry);
  return entry;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function benchRun(cx: BenchContext, options: RunOptions): Promise<RunOutcome> {
  const log = options.log ?? (() => {});
  const tuning = options.tuning ?? DEFAULT_RUN_TUNING;
  const writing = options.json !== true;
  if (writing && !isDefaultTuning(tuning)) throw new BenchError('bench/results.json is written only with the default tuning: add --json to run with --disable');
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const chosen = datasets.filter((d) => (options.only === undefined ? !isSealed(d) || writing : d.name === options.only));
  if (chosen.length === 0) throw new BenchError(options.only === undefined ? 'no tuning datasets' : `no dataset named ${options.only}`);
  const tuningSet = chosen.filter((d) => !isSealed(d));
  const sealedSet = chosen.filter(isSealed);
  const sealedOnly = tuningSet.length === 0;
  const tc = tuningSet.length > 0 ? await tuningContext(cx) : undefined;

  const roms: RomliftRow[] = [];
  const sealed: SealedEntry[] = [];
  const failed: RunFailure[] = [];
  const inputs: Record<string, RomInputs | string> = {};
  const families: Record<string, readonly string[]> = {};
  const timings: Record<string, { readonly scoreMs: number; readonly analysisCpuMs?: number; readonly analysisWallMs?: number }> = {};
  const speed = await readSpeedBaseline(cx);
  for (const d of tuningSet) {
    if (tc === undefined) break;
    const started = performance.now();
    try {
      const { row, inputs: read, analysis, scaffold } = await runTuning(cx, d, tc, options, tuning);
      roms.push(row);
      inputs[d.name] = { sha1: read.sha1, elfSha256: read.elfSha256 };
      families[d.name] = phase2RomFamilies({ deterministic: analysis.deterministic, speedBaseline: speed?.roms[d.name] !== undefined, scaffold });
      timings[d.name] = { scoreMs: Math.round(performance.now() - started), analysisCpuMs: Math.round(analysis.cpuMs), analysisWallMs: Math.round(analysis.wallMs) };
      log(`${summaryText(row)}`);
    } catch (error) {
      if (error instanceof BenchError) throw error;
      failed.push({ name: d.name, detail: message(error) });
    }
  }
  for (const d of sealedSet) {
    const started = performance.now();
    const read = await readRealInputs(cx, d);
    try {
      const entry = sealedEntry(read, options, tuning);
      sealed.push(entry);
      inputs[d.name] = { sha1: read.sha1, elfSha256: read.elfSha256 };
      timings[d.name] = { scoreMs: Math.round(performance.now() - started) };
      log(sealedText(entry));
    } catch {
      failed.push({ name: d.name, detail: 'the analysis failed (detail withheld: sealed)' });
    }
  }
  const report: BenchRunReport = {
    schema: BENCH_RUN_SCHEMA,
    roms: roms.sort((a, b) => compareCodeUnits(a.name, b.name)),
    sealed: sealed.sort((a, b) => compareCodeUnits(a.name, b.name)),
    failed,
  };
  await writeTimings(cx, timings);
  if (!writing || sealedOnly) return { report, gatesKept: false };
  if (failed.length > 0) throw new BenchError(`not writing bench/results.json: the analysis failed on ${failed.map((f) => f.name).join(', ')}`);
  if (tc !== undefined) inputs['pocSourceDigest'] = tc.pinnedPocDigest;
  const { results, gatesKept } = await writeArtifact(cx, report, inputs, families);
  return { report, results, gatesKept };
}

async function writeTimings(cx: BenchContext, roms: Readonly<Record<string, unknown>>): Promise<void> {
  const cpu = cpus()[0]?.model ?? 'unknown';
  await writeText(timingsPath(cx), prettyJson({ generatedAt: new Date().toISOString(), machine: { platform: platform(), arch: arch(), cpu, node: process.version }, roms }));
}

async function writeArtifact(
  cx: BenchContext,
  report: BenchRunReport,
  inputs: Readonly<Record<string, RomInputs | string>>,
  families: Readonly<Record<string, readonly string[]>>,
): Promise<{ readonly results: Results; readonly gatesKept: boolean }> {
  const nodeMajor = currentNodeMajor();
  const toolchain: Toolchain = await toolchainVersions();
  const meta: ResultsMeta = {
    commit: await gitHead(cx.repoRoot),
    dirty: await gitDirty(cx.repoRoot),
    sourceDigest: await sourceDigest(cx.repoRoot, nodeMajor),
    nodeMajor,
    romliftVersion: await romliftVersion(cx.repoRoot),
    inputs,
    toolchain,
    families,
    source: 'romlift',
    profile: benchProfile().id,
  };
  // The previous artifact holds what a run cannot recompute (the parity evidence, the printer summary
  // without a corpus run): refuse to drop either.
  const previous = await readResultsFile(resultsPath(cx)).catch((error: unknown) => {
    throw new BenchError(`refusing to overwrite bench/results.json: it does not parse (${error instanceof Error ? error.message : String(error)})`);
  });
  const gates = keptGates(previous, meta);
  const printer = await printerMember(cx, toolchain.as, previous?.printer);
  if (!printer.ok) throw new BenchError(`not writing bench/results.json: ${printer.reason}`);
  const results: Results = {
    meta,
    ...(printer.summary === undefined ? {} : { printer: printer.summary }),
    gates: { real: gates },
    roms: report.roms,
    ...(report.sealed.length === 0 ? {} : { sealed: report.sealed }),
    ...(previous?.parity === undefined ? {} : { parity: previous.parity }),
  };
  await writeResultsFile(resultsPath(cx), results);
  return { results, gatesKept: gates.length > 0 };
}

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;

/** One line per tuning ROM, with what moved against the PoC baseline. */
export function summaryText(r: RomliftRow): string {
  const unlistedMisses = r.misses.filter((m) => !m.listed).length;
  const unlistedFalse = r.falseEntries.filter((f) => !f.listed).length;
  return (
    `${r.name.padEnd(12)} found ${r.entries} of ${r.elfFunctions}, tp ${r.tp} (PoC ${r.poc.tp}), precision ${pct(r.precision)}, recall ${pct(r.recall)}, ` +
    `misses ${r.misses.length} (${unlistedMisses} unlisted), false ${r.falseEntries.length} (${unlistedFalse} unlisted), ` +
    `extents ${r.extents.agree}/${r.extents.sized} (${r.extents.lost.length} lost), code end ${r.codeEnd.delta >= 0 ? '+' : ''}${r.codeEnd.delta}, ` +
    `${r.deterministic ? 'deterministic' : 'NOT DETERMINISTIC'}, baseline diffs ${r.baselineRows.diffs.length} (${r.baselineRows.unaccepted.length} unaccepted, ${r.baselineRows.staleAccepted.length} stale), ` +
    `stale exceptions ${r.staleExceptions.length}`
  );
}

/** One line per sealed ROM: counts and the verdict, never an address or a name. */
export function sealedText(s: SealedEntry): string {
  const share = (n: number, d: number): string => (d === 0 ? 'n/a' : pct(n / d));
  const f = s.falseEntries;
  const g = s.gluedWhere;
  const where = g === undefined ? '' : ` (inside an extent ${g.insideExtent}, outside every extent ${g.outsideExtents}, past the code end ${g.pastCodeEnd})`;
  return (
    `${s.name.padEnd(12)} (sealed) ${s.pass ? 'pass' : 'FAIL'}: precision ${share(s.tp, s.entries)}, recall ${share(s.tp, s.elfFunctions)}, glued ${s.glued}${where}, ` +
    `label candidates ${s.labelCandidates}, extents ${s.extents.agree}/${s.extents.sized}, code end ${s.codeEnd.delta}, ` +
    `false entries: startup ${f.startup}, veneer ${f.veneer}, adr-callback ${f.adrCallback}, inside-elf-function ${f.insideElfFunction}, other ${f.other ?? 'not counted'}`
  );
}

// ---------------------------------------------------------------- reveal

export interface RevealOptions {
  readonly reason: string;
  readonly runner: AnalysisRunner;
  /** The time of the reveal (ISO 8601); the CLI passes the current time. */
  readonly at: string;
  readonly log?: (line: string) => void;
}

/**
 * Reveals a held-out dataset (D25, D53): appends {at, commit, reason} to its `revealed` log in
 * bench/dataset/real/<name>.json (the other fields untouched), then scores it as tuning data and
 * returns its row for stdout. results.json is never written.
 */
export async function revealDataset(cx: BenchContext, name: string, options: RevealOptions): Promise<RomliftRow> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const dataset = datasets.find((d) => d.name === name);
  if (dataset === undefined) throw new BenchError(`no dataset named ${name}`);
  const file = join(datasetDir(cx), `${name}.json`);
  if (!(await exists(file))) throw new BenchError(`the dataset ${name} is not in ${file}`);
  const raw = await readJson(file);
  if (!isRecord(raw)) throw new BenchError(`${file}: not a JSON object`);
  const reveal = { at: options.at, commit: (await gitHead(cx.repoRoot)) ?? 'none', reason: options.reason };
  let revealed: Dataset;
  try {
    revealed = appendReveal(dataset, reveal);
  } catch (error) {
    throw new BenchError(message(error));
  }
  await writeText(file, prettyJson({ ...raw, revealed: revealed.revealed }));
  options.log?.(`${name}: revealed (${file}); it is tuning data from now on and never counts toward g2.held-out again`);
  const tc = await tuningContext(cx);
  const { row } = await runTuning(cx, revealed, tc, { runner: options.runner, json: true }, DEFAULT_RUN_TUNING);
  return row;
}
