// The driver entry (the PoC's run()): the seed slot in order, then each pass of the profile runs grow
// and fillGaps until neither adds a function, then the region slot (each region claim and the startup region leave a
// trail event, so explain names the region rule that decided an address; phase 6, g6.explain-coverage); then the
// result is built from the final state. The rule registry is injected (runAnalysis) so driver tests run with fake rules; analyze
// and analyzeTuned bind RULES.
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { compareNumbers, sortedEntries, sortedKeys } from '../../../foundation/util/sorted.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import { compareRejections } from '../../provenance/provenance.ts';
import type { TrailSink } from '../../provenance/trail.ts';
import { fixpointLimit, LIMITS } from '../limits.ts';
import { Claim, claimName } from '../types.ts';
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
import { emit } from './trail.ts';

/** The tuning `analyze` runs with: epoch caching, nothing disabled (the worklist is always ascending, D10, D59). */
export const DEFAULT_TUNING: AnalysisTuning = { cache: 'epoch', disabled: [] };

/** Runs the seeds, the passes and the regions on `s`; returns the startup region. */
export function runDriver(s: DriverState): StartupRegion {
  for (const { id, rule } of s.rules.seed) {
    // accept() emits the 'propose' event of each seed as it queues it.
    for (const c of rule.seeds(s.view)) accept(s, { ...c, proposedBy: id });
  }
  for (const pass of s.profile.pipeline.passes) {
    for (let rounds = 0; ; rounds++) {
      if (rounds === LIMITS.fixpointRounds) {
        s.diagnostics.push(fixpointLimit(`the ${pass} pass`, rounds));
        break;
      }
      if (grow(s) + fillGaps(s, pass) === 0) break;
    }
  }
  let startup: StartupRegion | undefined;
  for (const { id, rule } of s.rules.region) {
    for (const e of rule.classify(s.view)) {
      emit(s, 'claim', e.span.start, id, [e.span.start], `${claimName(e.kind)} to ${hexAddr(e.span.end)}`);
      write(s, e);
    }
    const region = startup === undefined ? rule.startup?.(s.view) : undefined;
    if (region !== undefined) {
      emit(s, 'verdict', region.span.start, id, [region.span.start, ...region.entries], `startup region to ${hexAddr(region.span.end)}`);
      startup = region;
    }
  }
  return startup ?? { span: { start: s.rom.base, end: s.rom.base }, entries: [] };
}

const OWNED: ReadonlySet<number> = new Set([Claim.code, Claim.pool, Claim.table, Claim.dead]);

/**
 * The first index from `k` below `limit` whose claim is not `kind` (`limit` when none): byte by byte to a word boundary,
 * then a word of four equal claims at a time through `words` (a view of the same bytes), then byte by byte (final-review
 * gates-r1-1: the claim array is as long as the ROM).
 */
function sameRunEnd(claims: Uint8Array, words: Uint32Array | undefined, k: number, limit: number, kind: number): number {
  while (k < limit && (k & 3) !== 0) {
    if (claims[k] !== kind) return k;
    k++;
  }
  if (words !== undefined) {
    const four = (kind * 0x01010101) >>> 0;
    while (k + 4 <= limit && words[k >>> 2] === four) k += 4;
  }
  while (k < limit && claims[k] === kind) k++;
  return k;
}

/** Runs of equal claims in address order, split at every function extent's start and end. */
function claimRuns(s: DriverState, functions: readonly FunctionFact[]): readonly ClaimRun[] {
  const B = s.rom.base;
  const bounds = functions
    .flatMap((f) => [f.extent.start - B, f.extent.end - B])
    .sort(compareNumbers)
    .filter((b, i, all) => i === 0 || all[i - 1] !== b);
  const runs: ClaimRun[] = [];
  const claims = s.claims;
  const words = claims.byteOffset % 4 === 0 ? new Uint32Array(claims.buffer, claims.byteOffset, claims.length >>> 2) : undefined;
  let next = 0;
  for (let k = 0; k < claims.length; ) {
    const kind = (claims[k] ?? 0) as ClaimKind;
    if (kind === Claim.free) {
      k = sameRunEnd(claims, words, k, claims.length, kind);
      continue;
    }
    while (next < bounds.length && (bounds[next] ?? 0) <= k) next++;
    const limit = Math.min(bounds[next] ?? claims.length, claims.length);
    const start = k;
    k = sameRunEnd(claims, words, k, limit, kind);
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
