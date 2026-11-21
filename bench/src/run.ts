// `bench run [--only <rom>] [--json] [--scaffold] [--write-readability-floor] [--disable <rule>...]
// [--cpu-prof] [--reveal <rom> --reason <text>]` (architecture §8.2–8.5, D24, D25, D34, D41, D43, D62):
// scores romlift's own seedless discover run of every tuning dataset against its ELF (analysis-run.ts,
// score.ts) and the PoC baseline (baseline-rows.ts, accepted-diffs.ts), measures the emission families of
// phase 3 on it (scaffold.ts: the readability shares and the tree digest on every run; with --scaffold both
// printers' trees built and linked, the raw link as the row's `scaffold` verdict, and the objdiff family
// over the readable build), judges the locally built signature files on the same scored run when any are present
// (signatures.ts, the `signatures` family of phase 6, D24: the row's `signatures` member and meta.families; their
// digest in meta.inputs `signaturesDigest`), and runs the sealed held-out datasets through the classifiers, keeping
// counts only (seal.ts, classify.ts); a sealed dataset gets no emission or signatures family (`bench signatures`
// counts its placements).
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
//   --scaffold  builds and links both printers' trees in temporary directories and runs objdiff-cli at the
//            pinned version (toolchain.ts objdiffTool) on every agreeing function (objdiff.ts); from phase 4 it
//            also builds every chosen ROM, tuning and sealed, as a user does (scaffold.ts initBuild): a fresh
//            temporary directory holding only the ROM as baserom.gba, `romlift init` (the CLI from source under
//            the bin's heap cap), `./setup.sh` with ROMLIFT_CLI set to it (tools/agbcc copied from the cache
//            bench/.local/agbcc, built once from templates/agbcc.json's pin), and `make`. A tuning row records
//            `scaffold.init = {initExit, setupExit, makeExit, sha1Match}` (NOT_RUN, -1, for a step an earlier
//            failure skipped) beside the raw link's `scaffold.ok`; a sealed entry records the same four as `init`,
//            and none of its output is printed or kept (D25). The wall time goes to bench/timings.json
//            (`initBuildSeconds`), never to the artifact.
//   --write-readability-floor  (the phase lead, once) adds the measured shares of every tuning ROM that has
//            no floor to bench/baseline/readability.json; an existing floor is never changed (readability.ts).
// A lead run (no --json) also runs the memory family, bench/src/large-rom.ts as a child process, into the
// artifact's `memory` member (its peak RSS per command; its times go to bench/timings.json).
//
// Each row carries `parity: {digest, expected}`: the parity-view digest of the run (bench/src/parity.ts)
// and the PoC's committed one (bench/baseline/poc-digests.json). The PoC-parity evidence of milestone M1,
// the `parity` member of results.json (parity-evidence.ts), was recorded by a run under the PoC's LIFO
// worklist before 'poc-lifo' was deleted; every lead run keeps it unchanged.
import { arch, cpus, platform } from 'node:os';
import { join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type ElfSymbol,
  type GnuMap,
  type SignatureFile,
  compareCodeUnits,
  hexAddr,
  parseElf,
  parseGnuMap,
} from 'romlift';

import { type AcceptedDiffs, acceptedFor, readAcceptedDiffs } from './accepted-diffs.ts';
import {
  type AnalysisRunner,
  DEFAULT_RUN_TUNING,
  type DatasetAnalysis,
  type RealInputs,
  type RunTuning,
  analysisTuning,
  analyzeDataset,
  benchProfile,
  discoverOptions,
  isDefaultTuning,
  readRealInputs,
  sealedInput,
} from './analysis-run.ts';
import {
  type GateEntry,
  type MemoryMember,
  type Results,
  type ResultsMeta,
  type RomInputs,
  type SealedEntry,
  type Toolchain,
  parseMemory,
  readResultsFile,
  writeResultsFile,
} from './artifact.ts';
import { compareWithBaseline, parseBaselineRow } from './baseline-rows.ts';
import { type Baseline, type JsonRecord, baselineRowOf, readBaseline } from './baseline.ts';
import { type BenchContext, datasetDir, resultsPath, scoredPath, timingsPath } from './context.ts';
import { cpuProfPath, profiled, writeTopSelfTime } from './cpu-prof.ts';
import { type Dataset, isSealed, loadDatasets } from './dataset.ts';
import { currentNodeMajor, sourceDigest } from './digest.ts';
import { phase6RomFamilies } from './families.ts';
import { BenchError, exists, isRecord, prettyJson, readFileBytes, readJson, readText, writeText } from './files.ts';
import { gitDirty, gitHead } from './git.ts';
import type { ObjdiffSummary } from './objdiff.ts';
import { mapObjects, objectsDigest } from './objects.ts';
import { type PocDigests, parsePocDigests, pocDigestsPath } from './parity-view.ts';
import { resultParityDigest } from './parity.ts';
import { type PocDumpRows, dumpRowMismatch, readPocDumpRows } from './poc-dump-rows.ts';
import { readPinnedPocSource } from './poc-source.ts';
import { printerMember } from './printer.ts';
import { runProcess } from './process.ts';
import {
  type ReadabilityFloors,
  type ReadabilityMember,
  type Shares,
  addFloors,
  readReadabilityFloors,
  readabilityMember,
  sharesOf,
  writeReadabilityFloors,
} from './readability.ts';
import { readDump } from './rescore.ts';
import type { PocSource, RomliftRow } from './row.ts';
import {
  type EmissionFamilies,
  type InitBuild,
  type InitBuildVerdict,
  NOT_RUN,
  ROMLIFT_FAMILIES,
  initVerdict,
} from './scaffold.ts';
import { analysisFunctions, scoreAnalysis, staleExceptions } from './score.ts';
import { appendReveal, assertCountsOnly, sealedCounts, sealedPasses } from './seal.ts';
import {
  SIGNATURES_BUILD_LOOP,
  type SignaturesMember,
  locateBuiltSignatures,
  readBuiltSignatures,
  signaturesDigest,
  tuningSignatures,
} from './signatures.ts';
import { readSpeedBaseline } from './speed.ts';
import { objdiffTool, toolchainVersions } from './toolchain.ts';

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
  /** --scaffold: build and link both printers' trees and run the objdiff family. */
  readonly scaffold?: boolean;
  /** --write-readability-floor: add the floors of the tuning ROMs that have none (the phase lead). */
  readonly writeReadabilityFloor?: boolean;
  readonly runner: AnalysisRunner;
  /** The emission families; default romlift's (scaffold.ts ROMLIFT_FAMILIES). */
  readonly emission?: EmissionFamilies;
  /** The memory family of a lead run; default runLargeRom (bench/src/large-rom.ts as a child). */
  readonly largeRom?: (cx: BenchContext) => Promise<MemoryFamilyRun>;
  /** The objdiff-cli of a --scaffold run; default toolchain.ts objdiffTool. */
  readonly objdiffTool?: (cx: BenchContext) => Promise<string>;
  readonly log?: (line: string) => void;
  /**
   * Refuse a run that writes bench/results.json while no signature file is built and the committed artifact carries the
   * signatures family (`bench run` without --json sets it): the new artifact would lack the family, which `bench
   * provenance` rejects (final-review clean-clone-3).
   */
  readonly requireSignatures?: boolean;
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

/** Whether the committed bench/results.json records the signatures family (its `signaturesDigest`). */
async function committedSignatures(cx: BenchContext): Promise<boolean> {
  const previous = await readResultsFile(resultsPath(cx)).catch(() => undefined);
  return previous?.meta.inputs['signaturesDigest'] !== undefined;
}

/**
 * The tuning datasets whose committed row compares them with the PoC's own dump (`poc.source` 'dump', tmc since D60)
 * while that dump, bench/.local/poc/<rom>/scored.json, is missing: a run would write the row with no PoC reference
 * (`poc.source` 'none') and keep the gate record, which only the real-tier gates reject (final-review clean-clone-r1-1).
 */
export async function missingPocDumps(cx: BenchContext, datasets: readonly Dataset[]): Promise<readonly string[]> {
  const previous = await readResultsFile(resultsPath(cx)).catch(() => undefined);
  if (previous === undefined) return [];
  const missing: string[] = [];
  for (const d of datasets) {
    const row = previous.roms.find((r) => r.name === d.name);
    if (row?.poc?.source === 'dump' && !(await exists(scoredPath(cx, d.name)))) missing.push(scoredPath(cx, d.name));
  }
  return missing;
}

/** The previous gate record survives only if it was judged on the same sources and inputs. */
export function keptGates(
  previous: Results | undefined,
  meta: Pick<ResultsMeta, 'sourceDigest' | 'inputs'>,
): readonly GateEntry[] {
  if (previous === undefined) return [];
  if (previous.meta.sourceDigest !== meta.sourceDigest || !isDeepStrictEqual(previous.meta.inputs, meta.inputs))
    return [];
  return previous.gates.real;
}

/** What scoring a tuning dataset reads besides its run: the PoC baseline, the accepted improvements, the pinned PoC source. */
export interface TuningContext {
  readonly baseline: Baseline;
  readonly accepted: AcceptedDiffs;
  readonly pinnedPocDigest: string;
  /** bench/baseline/poc-digests.json, when committed. */
  readonly pocDigests?: PocDigests;
  /** bench/baseline/poc-dump-rows.json: the pinned PoC rows of the ROMs revealed after the baseline (D60). */
  readonly pocDumpRows?: PocDumpRows;
}

export async function tuningContext(cx: BenchContext): Promise<TuningContext> {
  const digestsPath = pocDigestsPath(cx);
  const pocDigests = (await exists(digestsPath))
    ? parsePocDigests(await readJson(digestsPath), digestsPath)
    : undefined;
  const pocDumpRows = await readPocDumpRows(cx);
  return {
    baseline: await readBaseline(cx),
    accepted: await readAcceptedDiffs(cx),
    pinnedPocDigest: (await readPinnedPocSource(cx)).digest,
    ...(pocDigests === undefined ? {} : { pocDigests }),
    ...(pocDumpRows === undefined ? {} : { pocDumpRows }),
  };
}

/**
 * The PoC's dump of `d`: its own row; refused when the dump is of another PoC source, and, for a ROM the
 * pinned baseline does not name, when it was made on another dataset or its row differs from the one
 * pinned in bench/baseline/poc-dump-rows.json. (Its scaffold verdict was the row's until phase 3.)
 */
async function pocDumpOf(
  cx: BenchContext,
  d: Dataset,
  tc: TuningContext,
): Promise<{ readonly pocRow: JsonRecord } | undefined> {
  const dump = await readDump(cx, d);
  if (dump === undefined) return undefined;
  const pinned = tc.pinnedPocDigest;
  if (dump.pocSourceDigest !== pinned)
    throw new BenchError(
      `${d.name}: the dump was made from PoC source ${dump.pocSourceDigest}, not the pinned ${pinned}: re-run export-poc`,
    );
  if (baselineRowOf(tc.baseline, d.name) === undefined) {
    const why = dumpRowMismatch(d, tc.pocDumpRows, dump.pocSourceDigest, dump.datasetDigest, dump.pocRow);
    if (why !== undefined) throw new BenchError(why);
  }
  return { pocRow: dump.pocRow };
}

/**
 * The PoC row a tuning ROM is compared with: its row in the pinned baseline; for a ROM that became tuning
 * data by a reveal after the baseline was pinned (tmc, D60), the PoC's own row of it from its dump (the
 * pinned PoC source run on that ROM by export-poc); else none, and the PoC thresholds are not applicable.
 */
export function pocReference(
  tc: TuningContext,
  d: Dataset,
  dumpRow: JsonRecord | undefined,
): { readonly record: JsonRecord; readonly source: PocSource } | undefined {
  const record = baselineRowOf(tc.baseline, d.name);
  if (record !== undefined) return { record, source: 'baseline' };
  if (d.revealed.length > 0 && dumpRow !== undefined) return { record: dumpRow, source: 'dump' };
  return undefined;
}

/** What the emission families measured of one tuning ROM. */
export interface RomEmission {
  readonly readability: ReadabilityMember;
  readonly treeDigest: string;
  /** romlift's raw link, and the build through init, setup.sh and make (--scaffold). */
  readonly scaffold?: { readonly ok: boolean; readonly init: InitBuildVerdict };
  /** The objdiff family over the readable build (--scaffold). */
  readonly objdiff?: ObjdiffSummary;
}

/** The full row of one tuning dataset from its analysis and its emission. */
export function romliftRow(
  inputs: RealInputs,
  analysis: DatasetAnalysis,
  tc: TuningContext,
  emission: RomEmission,
  dumpRow?: JsonRecord,
): RomliftRow {
  const d = inputs.dataset;
  const row = scoreAnalysis({
    result: analysis.result,
    diagnoses: analysis.diagnoses,
    truth: inputs.truth,
    dataset: d,
    sha1: inputs.sha1,
    deterministic: analysis.deterministic,
    ...(emission.scaffold === undefined ? {} : { scaffold: emission.scaffold }),
  });
  const reference = pocReference(tc, d, dumpRow);
  const found = new Set(analysisFunctions(analysis.result).map((f) => hexAddr(f.entry)));
  const comparison =
    reference === undefined
      ? {
          poc: { tp: 0, source: 'none' as const },
          lost: [],
          baselineRows: { diffs: [], unaccepted: [], staleAccepted: [] },
        }
      : (() => {
          const c = compareWithBaseline(
            parseBaselineRow(
              reference.record,
              reference.source === 'baseline' ? 'bench/baseline/poc-2026-10-16.json' : `the PoC dump of ${d.name}`,
            ),
            row,
            found,
            acceptedFor(tc.accepted, d.name),
          );
          return { ...c, poc: { ...c.poc, source: reference.source } };
        })();
  return {
    ...row,
    extents: { ...row.extents, lost: comparison.lost },
    analysisDigest: analysis.digests[0],
    poc: comparison.poc,
    staleExceptions: staleExceptions(d, row),
    baselineRows: comparison.baselineRows,
    parity: { digest: resultParityDigest(analysis.result), expected: tc.pocDigests?.roms[d.name] ?? '' },
    readability: emission.readability,
    ...(emission.scaffold === undefined ? {} : { scaffold: emission.scaffold }),
    ...(emission.objdiff === undefined ? {} : { objdiff: emission.objdiff }),
    treeDigest: emission.treeDigest,
  };
}

/** The reference ELF's symbols (readRealInputs already checked its digest). */
export async function elfSymbols(cx: BenchContext, d: Dataset): Promise<readonly ElfSymbol[]> {
  const elf = parseElf(await readFileBytes(join(cx.benchRoot, d.elf)));
  if (!elf.ok) throw new BenchError(`${d.name}: ${d.elf}: ${elf.error}`);
  return elf.value.symbols;
}

/**
 * The reference objects of a tuning dataset, refused when the dataset records none or their digest differs
 * (D50), with the objects its map links and the map itself when it records one (doctor-real's
 * `<rom>.objects-linked` checks they are the linked ones; the objdiff family reads each function's object from the
 * map, as bench/tools/objdiff-classes.ts does).
 */
export async function referenceObjects(
  cx: BenchContext,
  d: Dataset,
): Promise<{
  readonly dir: string;
  readonly digest: string;
  readonly linked?: ReadonlySet<string>;
  readonly map?: GnuMap;
}> {
  if (d.objectsDir === undefined || d.objectsDigest === undefined)
    throw new BenchError(
      `${d.name}: the dataset records no objectsDir and objectsDigest, which --scaffold's objdiff family needs`,
    );
  const dir = join(cx.benchRoot, d.objectsDir);
  const digest = await objectsDigest(dir).catch((error: unknown) => {
    throw new BenchError(`${d.name}: cannot read the reference objects ${dir}: ${message(error)}`);
  });
  if (digest !== d.objectsDigest)
    throw new BenchError(
      `${d.name}: refusing ${d.objectsDir}: digest ${digest}, the dataset records ${d.objectsDigest}`,
    );
  if (d.map === undefined) return { dir, digest };
  const map = parseGnuMap(await readText(join(cx.benchRoot, d.map)));
  if (!map.ok) throw new BenchError(`${d.name}: ${d.map}: ${map.error}`);
  return {
    dir,
    digest,
    linked: new Set(mapObjects(map.value).objects.map((o) => posix.normalize(o.file))),
    map: map.value,
  };
}

/** One tuning ROM's emission families: the readability shares always, the scaffold and objdiff with a tool. */
async function emissionOf(
  cx: BenchContext,
  inputs: RealInputs,
  analysis: DatasetAnalysis,
  run: TuningRun,
): Promise<{
  readonly emission: RomEmission;
  readonly objectsDigest?: string;
  readonly timings: Readonly<Record<string, number>>;
}> {
  const d = inputs.dataset;
  const emission = run.options.emission ?? ROMLIFT_FAMILIES;
  let started = performance.now();
  const read = emission.readability(inputs.rom, analysis.result);
  const timings: Record<string, number> = { readabilityMs: Math.round(performance.now() - started) };
  const readability = readabilityMember(sharesOf(read.stats), run.floors?.roms[d.name]);
  if (run.objdiff === undefined) return { emission: { readability, treeDigest: read.treeDigest }, timings };
  const objects = await referenceObjects(cx, d);
  started = performance.now();
  const built = await emission.scaffold({
    rom: inputs.rom,
    analysis: analysis.result,
    truth: inputs.truth,
    symbols: await elfSymbols(cx, d),
    objectsDir: objects.dir,
    objdiff: run.objdiff,
    ...(objects.linked === undefined ? {} : { linkedObjects: objects.linked }),
    ...(objects.map === undefined ? {} : { map: objects.map }),
  });
  Object.assign(timings, built.timings, { scaffoldMs: Math.round(performance.now() - started) });
  const init = await emission.initBuild({ cx, rom: inputs.rom, withhold: false });
  timings['initBuildSeconds'] = init.seconds;
  run.options.log?.(scaffoldText(d.name, built.raw, built.readable, built.objdiff, init));
  return {
    emission: {
      readability,
      treeDigest: read.treeDigest,
      scaffold: { ok: built.raw.ok, init: initVerdict(init) },
      objdiff: built.objdiff,
    },
    objectsDigest: objects.digest,
    timings,
  };
}

/** What every tuning ROM of one run shares: the options, the readability floors, the objdiff-cli of --scaffold. */
interface TuningRun {
  readonly options: RunOptions;
  readonly tuning: RunTuning;
  readonly floors: ReadabilityFloors | undefined;
  /** The objdiff-cli binary; undefined without --scaffold. */
  readonly objdiff: string | undefined;
  /** The locally built signature files (signatures/*.json); undefined when none are built, and the family does not run. */
  readonly signatures: readonly SignatureFile[] | undefined;
}

/** The signatures family of one tuning ROM on its scored run, when signature files are built. */
async function signaturesOf(
  cx: BenchContext,
  inputs: RealInputs,
  analysis: DatasetAnalysis,
  run: TuningRun,
): Promise<SignaturesMember | undefined> {
  if (run.signatures === undefined) return undefined;
  const judged = tuningSignatures(inputs, analysis.result, await elfSymbols(cx, inputs.dataset), run.signatures);
  return judged.member;
}

/** One tuning dataset analysed (profiled with --cpu-prof), scored, compared and emitted. */
async function runTuning(
  cx: BenchContext,
  d: Dataset,
  tc: TuningContext,
  run: TuningRun,
): Promise<{
  readonly row: RomliftRow;
  readonly inputs: RealInputs;
  readonly analysis: DatasetAnalysis;
  readonly objectsDigest?: string;
  readonly timings: Readonly<Record<string, number>>;
}> {
  const { options, tuning } = run;
  const inputs = await readRealInputs(cx, d);
  // The dump still gives a revealed ROM's PoC row (D60); from phase 3 its scaffold verdict is not read.
  const dump = await pocDumpOf(cx, d, tc);
  let analysis: DatasetAnalysis;
  if (options.cpuProf === true) {
    const { value, profile } = await profiled(() => analyzeDataset(inputs, options.runner, tuning));
    analysis = value;
    await writeTopSelfTime(cx, d.name, profile);
    options.log?.(`${d.name}: top self-time functions in ${cpuProfPath(cx, d.name)}`);
  } else {
    analysis = analyzeDataset(inputs, options.runner, tuning);
  }
  const emitted = await emissionOf(cx, inputs, analysis, run);
  const signatures = await signaturesOf(cx, inputs, analysis, run);
  const row = romliftRow(inputs, analysis, tc, emitted.emission, dump?.pocRow);
  return {
    row: signatures === undefined ? row : { ...row, signatures },
    inputs,
    analysis,
    ...(emitted.objectsDigest === undefined ? {} : { objectsDigest: emitted.objectsDigest }),
    timings: emitted.timings,
  };
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

/**
 * A sealed ROM built through init, setup.sh and make with its output withheld; a failure of the build itself (the
 * agbcc cache, a file) is withheld too and counts as nothing run.
 */
async function sealedInitBuild(cx: BenchContext, inputs: RealInputs, options: RunOptions): Promise<InitBuild> {
  try {
    return await (options.emission ?? ROMLIFT_FAMILIES).initBuild({ cx, rom: inputs.rom, withhold: true });
  } catch {
    return {
      initExit: NOT_RUN,
      setupExit: NOT_RUN,
      makeExit: NOT_RUN,
      sha1Match: false,
      seconds: 0,
      detail: 'the build failed (detail withheld: sealed)',
    };
  }
}

export async function benchRun(cx: BenchContext, options: RunOptions): Promise<RunOutcome> {
  const log = options.log ?? (() => {});
  const tuning = options.tuning ?? DEFAULT_RUN_TUNING;
  const writing = options.json !== true;
  if (writing && !isDefaultTuning(tuning))
    throw new BenchError(
      'bench/results.json is written only with the default tuning: add --json to run with --disable',
    );
  if (options.writeReadabilityFloor === true && !isDefaultTuning(tuning))
    throw new BenchError('the readability floors are written only with the default tuning: drop --disable');
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const chosen = datasets.filter((d) =>
    options.only === undefined ? !isSealed(d) || writing : d.name === options.only,
  );
  if (chosen.length === 0)
    throw new BenchError(options.only === undefined ? 'no tuning datasets' : `no dataset named ${options.only}`);
  const tuningSet = chosen.filter((d) => !isSealed(d));
  const sealedSet = chosen.filter(isSealed);
  const sealedOnly = tuningSet.length === 0;
  const tc = tuningSet.length > 0 ? await tuningContext(cx) : undefined;
  const scaffolding = options.scaffold === true && !sealedOnly;
  const run: TuningRun = {
    options,
    tuning,
    floors: await readReadabilityFloors(cx),
    objdiff: scaffolding ? await (options.objdiffTool ?? objdiffTool)(cx) : undefined,
    signatures: tuningSet.length === 0 ? undefined : await locateBuiltSignatures(cx),
  };
  if (
    writing &&
    options.requireSignatures === true &&
    tuningSet.length > 0 &&
    run.signatures === undefined &&
    (await committedSignatures(cx))
  ) {
    // The committed artifact carries the signatures family; an artifact without it would fail `bench provenance`.
    await readBuiltSignatures(cx);
  }
  if (writing && tuningSet.length > 0) {
    const missing = await missingPocDumps(cx, tuningSet);
    if (missing.length > 0) {
      throw new BenchError(
        `not writing bench/results.json: the committed artifact compares ${missing.length === 1 ? 'a ROM' : 'ROMs'} with the PoC's dump, and ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing; run npm run export-poc -- --mode scored (the PoC at ROMLIFT_POC) first`,
      );
    }
  }
  if (tuningSet.length > 0 && run.signatures === undefined) {
    log(
      `signatures: no built signature file in ${join(cx.repoRoot, 'signatures')}, so the signatures family does not run; build them first with\n  ${SIGNATURES_BUILD_LOOP}`,
    );
  }

  let roms: RomliftRow[] = [];
  const sealed: SealedEntry[] = [];
  const failed: RunFailure[] = [];
  const inputs: Record<string, RomInputs | string> = {};
  const families: Record<string, readonly string[]> = {};
  const timings: Record<string, Readonly<Record<string, number>>> = {};
  const speed = await readSpeedBaseline(cx);
  for (const d of tuningSet) {
    if (tc === undefined) break;
    const started = performance.now();
    try {
      const out = await runTuning(cx, d, tc, run);
      roms.push(out.row);
      inputs[d.name] = {
        sha1: out.inputs.sha1,
        elfSha256: out.inputs.elfSha256,
        ...(out.objectsDigest === undefined ? {} : { objectsDigest: out.objectsDigest }),
      };
      families[d.name] = phase6RomFamilies({
        deterministic: out.analysis.deterministic,
        speedBaseline: speed?.roms[d.name] !== undefined,
        scaffold: out.row.scaffold !== undefined,
        signatures: out.row.signatures !== undefined,
      });
      timings[d.name] = {
        scoreMs: Math.round(performance.now() - started),
        analysisCpuMs: Math.round(out.analysis.cpuMs),
        analysisWallMs: Math.round(out.analysis.wallMs),
        ...out.timings,
      };
      log(`${summaryText(out.row)}`);
    } catch (error) {
      if (error instanceof BenchError) throw error;
      failed.push({ name: d.name, detail: message(error) });
    }
  }
  for (const d of sealedSet) {
    const started = performance.now();
    const read = await readRealInputs(cx, d);
    try {
      const counted = sealedEntry(read, options, tuning);
      const scoreMs = Math.round(performance.now() - started);
      const build = options.scaffold === true ? await sealedInitBuild(cx, read, options) : undefined;
      const entry: SealedEntry = build === undefined ? counted : { ...counted, init: initVerdict(build) };
      assertCountsOnly(entry);
      sealed.push(entry);
      inputs[d.name] = { sha1: read.sha1, elfSha256: read.elfSha256 };
      timings[d.name] = { scoreMs, ...(build === undefined ? {} : { initBuildSeconds: build.seconds }) };
      log(sealedText(entry));
    } catch {
      failed.push({ name: d.name, detail: 'the analysis failed (detail withheld: sealed)' });
    }
  }
  if (options.writeReadabilityFloor === true && roms.length > 0) {
    if (failed.length > 0)
      throw new BenchError(
        `not writing the readability floors: the analysis failed on ${failed.map((f) => f.name).join(', ')}`,
      );
    const update = addFloors(
      run.floors,
      Object.fromEntries(roms.map((r) => [r.name, sharesOfMember(r.readability)] as const)),
    );
    await writeReadabilityFloors(cx, update.floors);
    log(
      `bench/baseline/readability.json: floors added for ${update.added.join(', ') || 'no ROM'}; kept as committed for ${update.kept.join(', ') || 'no ROM'}`,
    );
    roms = roms.map((r) => ({
      ...r,
      readability: readabilityMember(sharesOfMember(r.readability), update.floors.roms[r.name]),
    }));
  }
  const report: BenchRunReport = {
    schema: BENCH_RUN_SCHEMA,
    roms: roms.sort((a, b) => compareCodeUnits(a.name, b.name)),
    sealed: sealed.sort((a, b) => compareCodeUnits(a.name, b.name)),
    failed,
  };
  if (!writing || sealedOnly) {
    await writeTimings(cx, timings);
    return { report, gatesKept: false };
  }
  if (failed.length > 0) {
    await writeTimings(cx, timings);
    throw new BenchError(
      `not writing bench/results.json: the analysis failed on ${failed.map((f) => f.name).join(', ')}`,
    );
  }
  if (tc !== undefined) inputs['pocSourceDigest'] = tc.pinnedPocDigest;
  if (run.signatures !== undefined) inputs['signaturesDigest'] = signaturesDigest(run.signatures);
  const largeRom = await (options.largeRom ?? runLargeRom)(cx);
  log(memoryText(largeRom.member));
  await writeTimings(cx, { ...timings, ...(largeRom.timings === undefined ? {} : { 'large-rom': largeRom.timings }) });
  const { results, gatesKept } = await writeArtifact(cx, report, inputs, families, largeRom.member, scaffolding);
  return { report, results, gatesKept };
}

/** The shares of a readability member, without its floor. */
function sharesOfMember(m: ReadabilityMember): Shares {
  return {
    mnemonicShare: m.mnemonicShare,
    symbolicBranchShare: m.symbolicBranchShare,
    symbolicPoolShare: m.symbolicPoolShare,
  };
}

async function writeTimings(cx: BenchContext, roms: Readonly<Record<string, unknown>>): Promise<void> {
  const cpu = cpus()[0]?.model ?? 'unknown';
  await writeText(
    timingsPath(cx),
    prettyJson({
      generatedAt: new Date().toISOString(),
      machine: { platform: platform(), arch: arch(), cpu, node: process.version },
      roms,
    }),
  );
}

async function writeArtifact(
  cx: BenchContext,
  report: BenchRunReport,
  inputs: Readonly<Record<string, RomInputs | string>>,
  families: Readonly<Record<string, readonly string[]>>,
  memory: MemoryMember,
  scaffolding: boolean,
): Promise<{ readonly results: Results; readonly gatesKept: boolean }> {
  const nodeMajor = currentNodeMajor();
  // objdiff-cli's version is part of the toolchain of a run that used it.
  const toolchain: Toolchain = await toolchainVersions(process.env, scaffolding ? cx : undefined);
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
    throw new BenchError(
      `refusing to overwrite bench/results.json: it does not parse (${error instanceof Error ? error.message : String(error)})`,
    );
  });
  const gates = keptGates(previous, meta);
  const printer = await printerMember(cx, toolchain.as, previous?.printer);
  if (!printer.ok) throw new BenchError(`not writing bench/results.json: ${printer.reason}`);
  const results: Results = {
    meta,
    ...(printer.summary === undefined ? {} : { printer: printer.summary }),
    memory,
    gates: { real: gates },
    roms: report.roms,
    ...(report.sealed.length === 0 ? {} : { sealed: report.sealed }),
    ...(previous?.parity === undefined ? {} : { parity: previous.parity }),
  };
  await writeResultsFile(resultsPath(cx), results);
  return { results, gatesKept: gates.length > 0 };
}

// ---------------------------------------------------------------- the memory family

export const LARGE_ROM_SCHEMA = 'romlift/bench-large-rom@1';
/** The large-ROM script (g3.large-rom), run by path; its schema and output are large-rom.ts LARGE_ROM_SCHEMA and LargeRomReport. */
export const LARGE_ROM_SCRIPT = 'bench/src/large-rom.ts';

/** What one run of the large-ROM script gave: the artifact's member, and its volatile values for timings.json. */
export interface MemoryFamilyRun {
  readonly member: MemoryMember;
  readonly timings?: Readonly<Record<string, unknown>>;
}

/** The fields of the script's runs the artifact keeps; every other field (times) is volatile. */
const MEMORY_RUN_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'exitCode',
  'maxRssMiB',
  'maxOldSpaceSizeMiB',
  'treeDigest',
]);

/** The script's last stdout line, as the memory member and the volatile rest; a BenchError when it is not one. */
export function parseLargeRom(stdout: string): MemoryFamilyRun {
  const line = stdout.trimEnd().split('\n').at(-1) ?? '';
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new BenchError(`${LARGE_ROM_SCRIPT} --json printed no JSON last line`);
  }
  if (!isRecord(value) || value['schema'] !== LARGE_ROM_SCHEMA)
    throw new BenchError(`${LARGE_ROM_SCRIPT} --json printed no ${LARGE_ROM_SCHEMA} line`);
  const member = parseMemory(value, LARGE_ROM_SCRIPT);
  const runs = Array.isArray(value['runs']) ? value['runs'] : [];
  const volatile = runs
    .filter(isRecord)
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k === 'command' || !MEMORY_RUN_FIELDS.has(k))));
  return { member, timings: { runs: volatile } };
}

/** Runs `node --conditions=source bench/src/large-rom.ts <args>` from the repository root. */
export async function largeRomProcess(
  cx: BenchContext,
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const script = join(cx.repoRoot, LARGE_ROM_SCRIPT);
  if (!(await exists(script))) throw new BenchError(`${LARGE_ROM_SCRIPT} is missing`);
  return runProcess(process.execPath, ['--conditions=source', script, ...args], { cwd: cx.repoRoot, echoStderr: true });
}

/** The memory family of a lead run: the script with --json, its peak RSS per command. */
export async function runLargeRom(cx: BenchContext): Promise<MemoryFamilyRun> {
  const run = await largeRomProcess(cx, ['--json']);
  try {
    return parseLargeRom(run.stdout);
  } catch (error) {
    throw new BenchError(`not writing bench/results.json: ${message(error)} (exit ${run.code})`);
  }
}

export function memoryText(m: MemoryMember): string {
  return `memory: ${m.romBytes} bytes ${m.sha1}: ${m.runs.map((r) => `${r.command} exit ${r.exitCode} peak RSS ${r.maxRssMiB.toFixed(1)} MiB${r.maxOldSpaceSizeMiB === undefined ? '' : ` heap cap ${r.maxOldSpaceSizeMiB ?? 'none'}`}`).join(', ')}`;
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
    `stale exceptions ${r.staleExceptions.length}, readability ${shareText(r.readability)}${r.readability.floor === null ? ' (no floor)' : ` (floor ${shareText(r.readability.floor)})`}` +
    `${r.scaffold === undefined ? '' : `, scaffold ${r.scaffold.ok ? 'SHA-1' : 'FAILED'}`}${r.scaffold?.init === undefined ? '' : `, init build ${initText(r.scaffold.init)}`}` +
    `${r.signatures === undefined ? '' : `, signatures ${signaturesSummary(r.signatures)}`}`
  );
}

/** The signatures family in a few words: placements and tables with their wrong ones, sizes and names that differ. */
export function signaturesSummary(m: SignaturesMember): string {
  return `${m.placements.total} placements (${m.placements.wrong} wrong), ${m.tables.total} tables (${m.tables.wrong} wrong), ${m.sizes.differ} sizes and ${m.names.differ} reference names differ`;
}

const shareText = (s: Shares): string =>
  `${pct(s.mnemonicShare)}/${pct(s.symbolicBranchShare)}/${pct(s.symbolicPoolShare)}`;

/** An init build's verdict in a line: the SHA-1 match or FAILED, and each step's exit code ('-' when it did not run). */
export function initText(v: InitBuildVerdict): string {
  const exit = (code: number): string => (code === NOT_RUN ? '-' : String(code));
  return `${v.sha1Match ? 'SHA-1' : 'FAILED'} (init ${exit(v.initExit)}, setup.sh ${exit(v.setupExit)}, make ${exit(v.makeExit)})`;
}

/** One line per tuning ROM of --scaffold: both links, the objdiff family and the build through init, setup.sh and make. */
export function scaffoldText(
  name: string,
  raw: { readonly ok: boolean; readonly detail: string },
  readable: { readonly ok: boolean; readonly detail: string },
  objdiff: ObjdiffSummary,
  init?: InitBuild,
): string {
  const link = (l: { readonly ok: boolean; readonly detail: string }): string =>
    l.ok ? 'SHA-1' : `FAILED (${l.detail})`;
  const kinds = Object.entries(objdiff.differences).map(([k, n]) => `${n} ${k}`);
  const judged = objdiff.linked
    ? `objdiff scored ${objdiff.scored}, differences: ${kinds.join(', ') || 'none'}`
    : 'objdiff not run (the readable build does not link)';
  const built = init === undefined ? '' : `, init build ${initText(init)}${init.sha1Match ? '' : `: ${init.detail}`}`;
  return `${name.padEnd(12)} raw link ${link(raw)}, readable link ${link(readable)}, ${judged}${built}`;
}

/** One line per sealed ROM: counts and the verdict, never an address or a name. */
export function sealedText(s: SealedEntry): string {
  const share = (n: number, d: number): string => (d === 0 ? 'n/a' : pct(n / d));
  const f = s.falseEntries;
  const g = s.gluedWhere;
  const where =
    g === undefined
      ? ''
      : ` (inside an extent ${g.insideExtent}, outside every extent ${g.outsideExtents}, past the code end ${g.pastCodeEnd})`;
  return (
    `${s.name.padEnd(12)} (sealed) ${s.pass ? 'pass' : 'FAIL'}: precision ${share(s.tp, s.entries)}, recall ${share(s.tp, s.elfFunctions)}, glued ${s.glued}${where}, ` +
    `label candidates ${s.labelCandidates}, extents ${s.extents.agree}/${s.extents.sized}, code end ${s.codeEnd.delta}, ` +
    `false entries: startup ${f.startup}, veneer ${f.veneer}, adr-callback ${f.adrCallback}, inside-elf-function ${f.insideElfFunction}, other ${f.other ?? 'not counted'}` +
    `${s.init === undefined ? '' : `, init build ${initText(s.init)}`}`
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
  const run: TuningRun = {
    options: { runner: options.runner, json: true },
    tuning: DEFAULT_RUN_TUNING,
    floors: await readReadabilityFloors(cx),
    objdiff: undefined,
    signatures: await locateBuiltSignatures(cx),
  };
  const { row } = await runTuning(cx, revealed, tc, run);
  return row;
}
