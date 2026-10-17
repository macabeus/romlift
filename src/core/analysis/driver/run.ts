// The driver entry (the PoC's run()): the seed slot in order, then each pass of the profile runs grow
// and fillGaps until neither adds a function, then the region slot; then the result is built from the
// final state. The rule registry is injected (runAnalysis) so driver tests run with fake rules; analyze
// and analyzeTuned bind RULES.
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { compareNumbers, sortedEntries, sortedKeys } from '../../../foundation/util/sorted.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import { compareRejections } from '../../provenance/provenance.ts';
import type { TrailSink } from '../../provenance/trail.ts';
import { fixpointLimit, LIMITS } from '../limits.ts';
import { Claim } from '../types.ts';
import type {
  AnalysisOptions,
  AnalysisOptionsRecord,
  AnalysisResult,
  AnalysisTuning,
  ClaimKind,
  ClaimRun,
  FunctionFact,
  RuleRegistry,
  StartupRegion,
} from '../types.ts';
import { accept, write } from './accept.ts';
import { compareOverrides, compareSeeds } from './confirm.ts';
import { extentEndOf, factOf, ownerOf } from './facts.ts';
import { fillGaps } from './fill-gaps.ts';
import { grow } from './grow.ts';
import { RULES } from './rules.ts';
import { createDriver } from './state.ts';
import type { DriverState } from './state.ts';

/** The tuning `analyze` runs with: epoch caching, nothing disabled (the worklist is always ascending, D10, D59). */
export const DEFAULT_TUNING: AnalysisTuning = { cache: 'epoch', disabled: [] };

/** Each pass of the profile runs grow and fillGaps until neither adds a function. */
function runPasses(s: DriverState): void {
  for (const pass of s.profile.pipeline.passes) {
    for (let rounds = 0; ; rounds++) {
      if (rounds === LIMITS.fixpointRounds) {
        s.diagnostics.push(fixpointLimit(`the ${pass} pass`, rounds));
        break;
      }
      if (grow(s) + fillGaps(s, pass) === 0) break;
    }
  }
}

/**
 * Runs the seeds, the passes and the regions on `s`; returns the startup region. In confirm mode the
 * seeds of origin `listed` (the project's [functions]) are taken after the passes, and the passes then
 * run again (D60 k): first the rules take, of the listed entries, those they reach, in the order a
 * discover run takes them (an unlisted one is only reported), then the rest of the list is taken. A
 * reading depends on what was taken before it (a walk ends at a taken entry or at code another function
 * claimed; a reading kept for the epoch was walked when its candidate was first judged), so this order
 * gives confirm the readings discover gives.
 */
export function runDriver(s: DriverState): StartupRegion {
  const deferred = s.options.mode === 'confirm' ? s.rules.seed.filter(({ id }) => s.rules.origin.get(id) === 'listed') : [];
  for (const { id, rule } of s.rules.seed) {
    if (deferred.some((d) => d.id === id)) continue;
    // accept() emits the 'propose' event of each seed as it queues it.
    for (const c of rule.seeds(s.view)) accept(s, { ...c, proposedBy: id });
  }
  runPasses(s);
  if (deferred.length > 0) {
    for (const { id, rule } of deferred) for (const c of rule.seeds(s.view)) accept(s, { ...c, proposedBy: id });
    runPasses(s);
  }
  let startup: StartupRegion | undefined;
  for (const { rule } of s.rules.region) {
    for (const e of rule.classify(s.view)) write(s, e);
    startup ??= rule.startup?.(s.view);
  }
  return startup ?? { span: { start: s.rom.base, end: s.rom.base }, entries: [] };
}

const OWNED: ReadonlySet<number> = new Set([Claim.code, Claim.pool, Claim.table, Claim.dead]);

/** Runs of equal claims in address order, split at every function extent's start and end. */
function claimRuns(s: DriverState, functions: readonly FunctionFact[]): readonly ClaimRun[] {
  const B = s.rom.base;
  const bounds = functions
    .flatMap((f) => [f.extent.start - B, f.extent.end - B])
    .sort(compareNumbers)
    .filter((b, i, all) => i === 0 || all[i - 1] !== b);
  const runs: ClaimRun[] = [];
  let next = 0;
  for (let k = 0; k < s.claims.length; ) {
    const kind = (s.claims[k] ?? 0) as ClaimKind;
    if (kind === Claim.free) {
      k++;
      continue;
    }
    while (next < bounds.length && (bounds[next] ?? 0) <= k) next++;
    const limit = Math.min(bounds[next] ?? s.claims.length, s.claims.length);
    const start = k;
    while (k < limit && s.claims[k] === kind) k++;
    const owner = OWNED.has(kind) ? ownerOf(s, B + start) : undefined;
    runs.push({ span: { start: B + start, end: B + k }, kind, ...(owner === undefined ? {} : { owner }) });
  }
  return runs;
}

/** The options as the result records them: seeds and overrides in a total order, so the order the project lists them in never reaches the result. */
function optionsRecord(o: AnalysisOptions): AnalysisOptionsRecord {
  return { mode: o.mode, seeds: [...o.seeds].sort(compareSeeds), overrides: [...o.overrides].sort(compareOverrides), trail: o.trail, ...(o.trailFilter === undefined ? {} : { trailFilter: o.trailFilter }) };
}

/** The result of a finished run. */
export function resultOf(s: DriverState, startup: StartupRegion): AnalysisResult {
  const functions = sortedKeys(s.funcs).flatMap((e) => {
    const f = factOf(s, e);
    return f === undefined ? [] : [f];
  });
  let codeEnd: Addr = s.rom.base;
  for (const e of sortedKeys(s.funcs)) {
    const f = s.funcs.get(e);
    if (f !== undefined) codeEnd = Math.max(codeEnd, extentEndOf(s, f.reading));
  }
  const common = {
    schema: 'romlift/analysis@1' as const,
    rom: { sha1: s.rom.sha1, end: s.rom.end },
    profile: s.profile.id,
    options: optionsRecord(s.options),
    functions,
    claims: claimRuns(s, functions),
    startup,
    codeEnd,
    rejections: sortedEntries(s.rejections)
      .map(([, r]) => r)
      .sort(compareRejections),
    diagnostics: [...s.diagnostics],
  };
  if (s.options.mode === 'discover') return { ...common, mode: 'discover' };
  return {
    ...common,
    mode: 'confirm',
    unlisted: sortedEntries(s.unlisted).map(([, u]) => u),
    listedInvalid: sortedEntries(s.listedInvalid).map(([, l]) => l),
  };
}

/** The analysis with an explicit rule registry (internal: driver tests run fake rules through it). */
export function runAnalysis(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, tuning: AnalysisTuning, rules: RuleRegistry, sink?: TrailSink): AnalysisResult {
  const s = createDriver(rom, profile, options, tuning, rules, sink);
  return resultOf(s, runDriver(s));
}

/** The analysis of `rom` under `profile` (architecture §3.3). */
export function analyze(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, sink?: TrailSink): AnalysisResult {
  return runAnalysis(rom, profile, options, DEFAULT_TUNING, RULES, sink);
}

/** The analysis with internal tuning (romlift/internal, outside semver). */
export function analyzeTuned(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, tuning: AnalysisTuning, sink?: TrailSink): AnalysisResult {
  return runAnalysis(rom, profile, options, tuning, RULES, sink);
}
