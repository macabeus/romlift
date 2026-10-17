// romlift's own seedless discover run of one dataset (architecture §8.2–8.4, D24, D50): the ROM and the
// ELF are read and refused when their digests differ from the dataset; the analysis runs with the
// bench's tuning (worklist, epoch cache, disabled rules) and its CPU time is measured; then
// diagnoseMisses re-runs it and diagnoses every ELF function the first run missed, and the canonical
// digests of the two results say whether the analysis is deterministic. The analysis is reached through
// an AnalysisRunner so the bench tests run it on hand-built results; ROMLIFT_RUNNER is the real one.
import { join } from 'node:path';

import {
  canonicalJson,
  parseElf,
  profileById,
  romFromBytes,
  type AnalysisOptions,
  type AnalysisResult,
  type CompilerProfile,
  type JsonValue,
  type Rom,
  type RuleId,
  type TrailSink,
} from 'romlift';
import { analyzeTuned, DEFAULT_TUNING, diagnoseMisses, type AnalysisTuning, type MissDiagnosis, type MissQuery } from 'romlift/internal';
import { sha1Of, sha256Of, sha256Stream } from 'romlift/node';

import type { FoundFunction as ClassifiedFunction, NoReturnSite } from './classify.ts';
import type { BenchContext } from './context.ts';
import type { Dataset } from './dataset.ts';
import { BenchError, exists, readFileBytes } from './files.ts';
import type { SealedInput } from './seal.ts';
import { elfTruth, type Truth } from './truth.ts';

/** The ROM and ELF of one dataset, both checked against its recorded digests. */
export interface RealInputs {
  readonly dataset: Dataset;
  readonly rom: Rom;
  readonly sha1: string;
  readonly elfSha256: string;
  readonly romSize: number;
  readonly truth: Truth;
}

/** Reads the dataset's ROM and ELF; refuses either when it is missing or its digest differs (D50). */
export async function readRealInputs(cx: BenchContext, d: Dataset): Promise<RealInputs> {
  const romPath = join(cx.benchRoot, d.rom);
  const elfPath = join(cx.benchRoot, d.elf);
  if (!(await exists(romPath))) throw new BenchError(`${d.name}: the ROM ${romPath} is missing`);
  if (!(await exists(elfPath))) throw new BenchError(`${d.name}: the ELF ${elfPath} is missing`);
  const bytes = await readFileBytes(romPath);
  const sha1 = sha1Of(bytes);
  if (sha1 !== d.sha1) throw new BenchError(`${d.name}: refusing ${d.rom}: SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  const elfBytes = await readFileBytes(elfPath);
  const elfSha256 = sha256Of(elfBytes);
  if (elfSha256 !== d.elfSha256) throw new BenchError(`${d.name}: refusing ${d.elf}: sha256 ${elfSha256}, the dataset records ${d.elfSha256}`);
  const elf = parseElf(elfBytes);
  if (!elf.ok) throw new BenchError(`${d.name}: ${d.elf}: ${elf.error}`);
  return { dataset: d, rom: romFromBytes(bytes, sha1), sha1, elfSha256, romSize: bytes.length, truth: elfTruth(elf.value, bytes.length) };
}

/** How the bench reaches the analysis: analyzeTuned and diagnoseMisses with their own signatures. */
export interface AnalysisRunner {
  analyze(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, tuning: AnalysisTuning, sink?: TrailSink): AnalysisResult;
  diagnose(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, tuning: AnalysisTuning, misses: readonly MissQuery[]): { readonly result: AnalysisResult; readonly diagnoses: readonly MissDiagnosis[] };
}

/** romlift's analysis with the registered rules. */
export const ROMLIFT_RUNNER: AnalysisRunner = {
  analyze: (rom, profile, options, tuning, sink) => analyzeTuned(rom, profile, options, tuning, sink),
  diagnose: (rom, profile, options, tuning, misses) => diagnoseMisses(rom, profile, options, tuning, misses),
};

/** The profile the bench scores: agbcc, the only one release 1 ships. */
export function benchProfile(): CompilerProfile {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new BenchError("romlift has no 'agbcc' profile");
  return profile;
}

/** The tuning knobs the bench exposes (`--worklist`, `--disable`); the cache is always 'epoch'. */
export interface RunTuning {
  readonly worklist: AnalysisTuning['worklist'];
  readonly disabled: readonly RuleId[];
}

/** analyze's own tuning: its worklist, nothing disabled. */
export const DEFAULT_RUN_TUNING: RunTuning = { worklist: DEFAULT_TUNING.worklist, disabled: [] };

export function isDefaultTuning(t: RunTuning): boolean {
  return t.worklist === DEFAULT_RUN_TUNING.worklist && t.disabled.length === 0;
}

export function analysisTuning(t: RunTuning): AnalysisTuning {
  return { worklist: t.worklist, cache: 'epoch', disabled: [...t.disabled] };
}

/** The seedless discover run the bench scores (D24): no TOML, signature or evidence seeds. */
export function discoverOptions(trail: AnalysisOptions['trail'] = 'off'): AnalysisOptions {
  return { mode: 'discover', seeds: [], overrides: [], trail };
}

export interface Measured<T> {
  readonly value: T;
  /** User plus system CPU time of this process (process.cpuUsage), in milliseconds. */
  readonly cpuMs: number;
  readonly wallMs: number;
}

/** Runs `fn` and measures its CPU and wall time. */
export function measure<T>(fn: () => T): Measured<T> {
  const wall = performance.now();
  const cpu = process.cpuUsage();
  const value = fn();
  const used = process.cpuUsage(cpu);
  return { value, cpuMs: (used.user + used.system) / 1000, wallMs: performance.now() - wall };
}

/** The digest of one analysis: sha256 of the canonical JSON of the whole result. */
export function resultDigest(result: AnalysisResult): string {
  return sha256Stream(canonicalJson(result as unknown as JsonValue));
}

/** The ELF functions from the end of the startup region that the run did not report, in address order. */
export function missQueries(result: Pick<AnalysisResult, 'functions' | 'startup'>, truth: Truth): MissQuery[] {
  const found = new Set(result.functions.map((f) => f.entry));
  return truth.functions
    .filter((t) => t.addr >= result.startup.span.end && !found.has(t.addr))
    .map((t) => ({ addr: t.addr, mode: t.thumb ? ('thumb' as const) : ('arm' as const) }))
    .sort((a, b) => a.addr - b.addr);
}

/** One measured, diagnosed and twice-run analysis of a dataset. */
export interface DatasetAnalysis {
  readonly result: AnalysisResult;
  readonly diagnoses: readonly MissDiagnosis[];
  /** The digests of the two runs. */
  readonly digests: readonly [string, string];
  readonly deterministic: boolean;
  /** The CPU and wall time of the first run alone. */
  readonly cpuMs: number;
  readonly wallMs: number;
}

/** Runs, measures, diagnoses and re-runs the analysis of `inputs` (the second run is diagnoseMisses'). */
export function analyzeDataset(inputs: Pick<RealInputs, 'rom' | 'truth'>, runner: AnalysisRunner, tuning: RunTuning): DatasetAnalysis {
  const profile = benchProfile();
  const t = analysisTuning(tuning);
  const first = measure(() => runner.analyze(inputs.rom, profile, discoverOptions(), t));
  const second = runner.diagnose(inputs.rom, profile, discoverOptions(), t, missQueries(first.value, inputs.truth));
  const digests = [resultDigest(first.value), resultDigest(second.result)] as const;
  return { result: first.value, diagnoses: second.diagnoses, digests, deterministic: digests[0] === digests[1], cpuMs: first.cpuMs, wallMs: first.wallMs };
}

/**
 * One run that also diagnoses every ELF function inside the ROM (the found ones are diagnosed as inside
 * code and never read): the result and the miss reasons in a single analysis, for checks that need no
 * timing and no determinism (dataset-check, adopt).
 */
export function diagnosedRun(inputs: Pick<RealInputs, 'rom' | 'truth'>, runner: AnalysisRunner, tuning: RunTuning): { readonly result: AnalysisResult; readonly diagnoses: readonly MissDiagnosis[] } {
  const queries = inputs.truth.functions.map((t) => ({ addr: t.addr, mode: t.thumb ? ('thumb' as const) : ('arm' as const) }));
  return runner.diagnose(inputs.rom, benchProfile(), discoverOptions(), analysisTuning(tuning), queries);
}

/** The never-returning sites of a function: its noreturn bl verdicts (4 bytes) and its swi ends. */
function noReturnSites(f: AnalysisResult['functions'][number]): NoReturnSite[] {
  const sites: NoReturnSite[] = f.blVerdicts.filter((v) => v.verdict === 'noreturn').map((v) => ({ site: v.site, size: 4 }));
  for (const e of f.exits) if (e.kind === 'swi-end') sites.push({ site: e.at, size: f.mode === 'thumb' ? 2 : 4 });
  return sites.sort((a, b) => a.site - b.site);
}

/** The classifiers' input for a sealed run (classify.ts, seal.ts), built from the analysis. */
export function sealedInput(name: string, inputs: Pick<RealInputs, 'rom' | 'truth'>, result: AnalysisResult, profile: CompilerProfile): SealedInput {
  const thumb = new Map(inputs.truth.functions.map((t) => [t.addr, t.thumb]));
  const found: ClassifiedFunction[] = result.functions.map((f) => ({
    entry: f.entry,
    mode: f.mode,
    extent: { start: f.extent.start, end: f.extent.end },
    holes: f.holes.map((h) => ({ start: h.start, end: h.end })),
    branchTargets: [...f.branchTargets],
    noReturnSites: noReturnSites(f),
    callTargets: f.calls.map((c) => c.target),
    origin: f.origin,
  }));
  return {
    name,
    found,
    truth: inputs.truth.functions.map((t) => ({ addr: t.addr, size: t.size, thumb: t.thumb })),
    startupEnd: result.startup.span.end,
    isPrologue: (addr) => profile.idioms.isPrologue(inputs.rom, addr, thumb.get(addr) === false ? 'arm' : 'thumb'),
    codeEnd: result.codeEnd,
  };
}
