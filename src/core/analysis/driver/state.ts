// The driver's state (architecture §4.1, §4.2): every mutable structure of one run, owned by the driver;
// rules see it only through the view (view.ts). createDriver builds it and wires the view's services
// (read, valid, whyInvalid) to settle.ts and validity.ts.
import { RomliftInvariantError } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import type { IntervalIndex } from '../../../foundation/util/interval-index.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import type { Provenance, Rejection } from '../../provenance/provenance.ts';
import type { TrailSink } from '../../provenance/trail.ts';
import type { Origin } from '../../provenance/vocabulary.ts';
import { addressMap } from '../address-map.ts';
import type { AddressMap } from '../address-map.ts';
import { buildPointerIndex } from '../pointers.ts';
import type { PointerIndex } from '../pointers.ts';
import { Claim } from '../types.ts';
import type {
  AnalysisOptions,
  AnalysisTuning,
  AnalysisView,
  ClaimKind,
  ListedInvalid,
  Reading,
  RuleRegistry,
  Seed,
  UnlistedFinding,
  ValidityFailure,
} from '../types.ts';
import type { WalkEnv } from '../walk/cursor.ts';
import { listedSeeds } from './confirm.ts';
import { reuseState } from './reuse.ts';
import type { ReuseState } from './reuse.ts';
import { resolveRules } from './rules.ts';
import type { ResolvedRules } from './rules.ts';
import { read } from './settle.ts';
import { valid, whyInvalid } from './validity.ts';
import { wellFormedSeeds } from './seeds.ts';
import { makeView } from './view.ts';

/** An accepted function: its current reading and how it was accepted. */
export interface Accepted {
  /** Replaced, never mutated, when a block is absorbed. */
  reading: Reading;
  readonly origin: Origin;
  readonly accepted: Provenance;
  readonly also: Provenance[];
  readonly absorbed: Span[];
}

/** The services the view exposes, implemented by settle.ts and validity.ts. */
export interface DriverServices {
  read(entry: Addr, mode: Mode): Reading;
  valid(entry: Addr): boolean;
  whyInvalid(entry: Addr): ValidityFailure | undefined;
}

export interface DriverInputs {
  readonly rom: Rom;
  readonly profile: CompilerProfile;
  readonly options: AnalysisOptions;
  readonly tuning: AnalysisTuning;
  readonly rules: ResolvedRules;
  readonly addresses: AddressMap;
  readonly pointers: PointerIndex;
  readonly sink?: TrailSink;
}

export interface DriverState extends DriverInputs {
  /** One claim kind per ROM byte. */
  readonly claims: Uint8Array;
  readonly funcs: Map<Addr, Accepted>;
  /** One bit per ROM byte: an accepted or listed entry starts there (isFunction's index, kept by markEntry). */
  readonly entryBits: Uint8Array;
  /** The 'epoch-reuse' cache (reuse.ts); absent in 'epoch' mode and with a trail. */
  readonly reuse?: ReuseState;
  /** Accepted entries in acceptance order. */
  readonly order: Addr[];
  /** Thumb readings of the epoch (accepted ones for good). */
  readonly settled: Map<Addr, Reading>;
  /** The estimated bytes of the readings `settled` holds for entries not accepted (epoch.ts hold), against LIMITS.epochReadingBytes. */
  held: number;
  /** The last ARM reading of each entry; never served as a cache, only peeked (D56). */
  readonly lastArm: Map<Addr, Reading>;
  readonly inProgress: Set<Addr>;
  validMemo: Map<Addr, boolean>;
  readonly neverValid: Set<Addr>;
  /** The distinct harvest targets grow has judged in this run, against LIMITS.candidateBudget (grow.ts). */
  readonly judged: Set<Addr>;
  readonly rejections: Map<string, Rejection>;
  readonly adrOwner: Map<Addr, Addr>;
  /** Confirm mode: the listed entries, and their addresses ascending. */
  readonly listed: ReadonlyMap<Addr, Seed>;
  readonly listedOrder: readonly Addr[];
  readonly unlisted: Map<Addr, UnlistedFinding>;
  readonly listedInvalid: Map<Addr, ListedInvalid>;
  readonly diagnostics: Diagnostic[];
  round: number;
  epoch: number;
  seq: number;
  ownerIndex: IntervalIndex<Addr> | undefined;
  readonly services: DriverServices;
  readonly view: AnalysisView;
  readonly walkEnv: WalkEnv;
}

/** The claim kind of a byte; free outside the ROM. */
export function claimAt(s: DriverState, a: Addr): ClaimKind {
  const k = a - s.rom.base;
  return k >= 0 && k < s.claims.length ? ((s.claims[k] ?? 0) as ClaimKind) : Claim.free;
}

/**
 * Accepted, in both modes (D60 k, revising D8): in confirm mode a listed entry is a function once it is
 * taken, as in discover, so a walk passes through an entry that is not taken yet, as discover's walk of
 * the function around it did. Every listed entry is taken before the run ends (run.ts).
 */
export function isFunction(s: DriverState, a: Addr): boolean {
  const k = a - s.rom.base;
  if (k >= 0 && k < s.claims.length && Number.isInteger(k)) return ((s.entryBits[k >>> 3] ?? 0) & (1 << (k & 7))) !== 0;
  return s.funcs.has(a);
}

/** Records that a function starts at `a` in isFunction's index (accepted or listed entries only). */
export function markEntry(s: Pick<DriverState, 'rom' | 'claims' | 'entryBits'>, a: Addr): void {
  const k = a - s.rom.base;
  if (k >= 0 && k < s.claims.length && Number.isInteger(k)) s.entryBits[k >>> 3] = (s.entryBits[k >>> 3] ?? 0) | (1 << (k & 7));
}

/** A fresh driver state for one run. */
export function createDriver(rom: Rom, profile: CompilerProfile, given: AnalysisOptions, tuning: AnalysisTuning, registry: RuleRegistry, sink?: TrailSink): DriverState {
  const rules = resolveRules(profile, registry, tuning);
  // A malformed seed never reaches a rule or the result's options (seeds.ts).
  const checked = wellFormedSeeds(rom, given.seeds);
  const options: AnalysisOptions = checked.seeds.length === given.seeds.length ? given : { ...given, seeds: checked.seeds };
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
    ...(tuning.cache === 'epoch-reuse' && options.trail === 'off' ? { reuse: reuseState(rom.base, rom.bytes.length) } : {}),
    order: [],
    settled: new Map(),
    held: 0,
    lastArm: new Map(),
    inProgress: new Set(),
    validMemo: new Map(),
    neverValid: new Set(),
    judged: new Set(),
    rejections: new Map(),
    adrOwner: new Map(),
    listed,
    listedOrder: sortedKeys(listed),
    unlisted: new Map(),
    listedInvalid: new Map(),
    diagnostics: [...checked.diagnostics],
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
    walkEnv: { view, policies: rules.walk, extentEnd: (shape) => rules.extentEnd(shape, profile), trace: sink !== undefined && options.trail !== 'off' },
  };
  return state;
}

