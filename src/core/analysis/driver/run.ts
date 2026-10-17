// The driver entry (the PoC's run()): the seed slot in order, then each pass of the profile runs grow
// and fillGaps until neither adds a function, then the region slot; then the result is built from the
// final state. The rule registry is injected (runAnalysis) so driver tests run with fake rules; analyze
// and analyzeTuned bind RULES.
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { compareNumbers, sortedEntries, sortedKeys } from '../../../foundation/util/sorted.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import { compareRejections } from '../../provenance/provenance.ts';
import type { TrailSink } from '../../provenance/trail.ts';
import { addressMap } from '../address-map.ts';
import { fixpointLimit, LIMITS } from '../limits.ts';
import { buildPointerIndex } from '../pointers.ts';
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
import { listedSeeds } from './confirm.ts';
import { fillGaps } from './fill-gaps.ts';
import { grow } from './grow.ts';
import { resolveRules, RULES } from './rules.ts';
import { reuseState } from './reuse.ts';
import { read } from './settle.ts';
import { valid, whyInvalid } from './validity.ts';
import { emit, extentEndOf, factOf, makeView, markEntry, ownerOf } from './view.ts';
import type { DriverState } from './view.ts';

/** The tuning `analyze` runs with: the PoC's LIFO until milestone M4, epoch caching, nothing disabled. */
export const DEFAULT_TUNING: AnalysisTuning = { worklist: 'poc-lifo', cache: 'epoch', disabled: [] };

/** A fresh driver state for one run. */
export function createDriver(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, tuning: AnalysisTuning, registry: RuleRegistry, sink?: TrailSink): DriverState {
  const rules = resolveRules(profile, registry, tuning);
  const listed = listedSeeds(options);
  let state: DriverState | undefined;
  const get = (): DriverState => {
    if (state === undefined) throw new RomliftInvariantError('the analysis view was used before the driver state was built');
    return state;
  };
  const view = makeView(get);
  state = {
    rom,
    profile,
    options,
    tuning,
    rules,
    addresses: addressMap(options.overrides),
    pointers: buildPointerIndex(rom),
    ...(sink === undefined ? {} : { sink }),
    claims: new Uint8Array(rom.bytes.length),
    funcs: new Map(),
    entryBits: new Uint8Array((rom.bytes.length + 7) >>> 3),
    ...(tuning.cache === 'epoch-reuse' && options.trail === 'off' && tuning.oracle === undefined ? { reuse: reuseState(rom.base, rom.bytes.length) } : {}),
    order: [],
    settled: new Map(),
    lastArm: new Map(),
    inProgress: new Set(),
    validMemo: new Map(),
    neverValid: new Set(),
    rejections: new Map(),
    adrOwner: new Map(),
    listed,
    listedOrder: sortedKeys(listed),
    unlisted: new Map(),
    listedInvalid: new Map(),
    diagnostics: [],
    round: 0,
    epoch: 0,
    seq: 0,
    ownerIndex: undefined,
    services: {
      read: (entry, mode) => read(get(), entry, mode),
      valid: (entry) => valid(get(), entry),
      whyInvalid: (entry) => whyInvalid(get(), entry),
    },
    view,
    walkEnv: { view, policies: rules.walk, extentEnd: (shape) => rules.extentEnd(shape, profile) },
  };
  for (const entry of state.listedOrder) markEntry(state, entry);
  return state;
}

/** Runs the seeds, the passes and the regions on `s`; returns the startup region. */
export function runDriver(s: DriverState): StartupRegion {
  for (const { id, rule } of s.rules.seed) {
    for (const c of rule.seeds(s.view)) {
      emit(s, 'propose', c.entry, id, c.cites, c.mode);
      accept(s, c);
    }
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

function optionsRecord(o: AnalysisOptions): AnalysisOptionsRecord {
  return { mode: o.mode, seeds: o.seeds, overrides: o.overrides, trail: o.trail, ...(o.trailFilter === undefined ? {} : { trailFilter: o.trailFilter }) };
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
