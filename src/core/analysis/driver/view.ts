// The driver's state and the AnalysisView over it (architecture §4.1, §4.2). The driver owns every
// mutable structure here; rules see only the view. The view's read, valid and whyInvalid are the
// driver's services (settle.ts, validity.ts), injected so this module imports none of them.
import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../../foundation/rom/span.ts';
import { innermost, intervalIndex } from '../../../foundation/util/interval-index.ts';
import type { IntervalIndex } from '../../../foundation/util/interval-index.ts';
import type { CompilerProfile } from '../../profile/types.ts';
import { capCites } from '../../provenance/provenance.ts';
import type { Provenance, Rejection } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { trailKeeps } from '../../provenance/trail.ts';
import type { TrailKind, TrailSink } from '../../provenance/trail.ts';
import type { MissReason, Origin } from '../../provenance/vocabulary.ts';
import type { AddressMap } from '../address-map.ts';
import type { PointerIndex } from '../pointers.ts';
import { Claim } from '../types.ts';
import type {
  AnalysisOptions,
  AnalysisTuning,
  AnalysisView,
  Candidate,
  ClaimKind,
  FunctionFact,
  ListedInvalid,
  OverrideFact,
  Reading,
  Seed,
  UnlistedFinding,
  ValidityFailure,
} from '../types.ts';
import type { WalkEnv } from '../walk/cursor.ts';
import type { ResolvedRules } from './rules.ts';

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
  /** Accepted entries in acceptance order. */
  readonly order: Addr[];
  /** Thumb readings of the epoch (accepted ones for good). */
  readonly settled: Map<Addr, Reading>;
  /** The last ARM reading of each entry; never served as a cache, only peeked (D56). */
  readonly lastArm: Map<Addr, Reading>;
  readonly inProgress: Set<Addr>;
  validMemo: Map<Addr, boolean>;
  readonly neverValid: Set<Addr>;
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

/** discover: accepted; confirm: listed or accepted. */
export function isFunction(s: DriverState, a: Addr): boolean {
  return s.funcs.has(a) || s.listed.has(a);
}

/** The FunctionFact of an accepted entry under the current claims. */
export function factOf(s: DriverState, entry: Addr): FunctionFact | undefined {
  const f = s.funcs.get(entry);
  if (f === undefined) return undefined;
  const r = f.reading;
  const extent = { start: r.entry, end: extentEndOf(s, r) };
  const code: Span[] = [];
  for (const i of r.insns) {
    const last = code[code.length - 1];
    if (last !== undefined && last.end >= i.addr) code[code.length - 1] = { start: last.start, end: Math.max(last.end, i.addr + i.len) };
    else code.push({ start: i.addr, end: i.addr + i.len });
  }
  const dead: Span[] = [];
  for (let a = extent.start; a < extent.end; a++) {
    if (claimAt(s, a) !== Claim.dead) continue;
    const last = dead[dead.length - 1];
    if (last !== undefined && last.end === a) dead[dead.length - 1] = { start: last.start, end: a + 1 };
    else dead.push({ start: a, end: a + 1 });
  }
  const pools = r.pools.map((p) => p.addr).sort((a, b) => a - b);
  const inside = (a: Addr): boolean => a >= extent.start && a + 4 <= extent.end;
  return {
    entry: r.entry,
    mode: r.mode,
    extent,
    codeEnd: r.codeEnd,
    code,
    dead,
    pools: pools.filter(inside),
    farPools: pools.filter((a) => !inside(a)),
    tables: r.tables,
    calls: r.calls,
    blVerdicts: r.blVerdicts,
    exits: r.exits,
    branchTargets: r.branchTargets,
    adrs: r.adrs,
    veneers: r.veneers,
    absorbed: [...f.absorbed].sort((a, b) => a.start - b.start),
    holes: r.holes,
    origin: f.origin,
    accepted: f.accepted,
    also: f.also,
  };
}

/** The extent end of a reading; in confirm mode a listed function without a size is cut at the next listed entry that is not a label (§4.2). */
export function extentEndOf(s: DriverState, r: Reading): Addr {
  const seed = s.listed.get(r.entry);
  if (seed === undefined) return r.end;
  if (seed.size !== undefined) return r.entry + seed.size;
  const order = s.listedOrder;
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((order[mid] ?? 0) <= r.entry) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < order.length; i++) {
    const a = order[i] ?? 0;
    if (a >= r.end) break;
    if (s.listed.get(a)?.label !== true) return a;
  }
  return r.end;
}

/** The innermost accepted extent covering `a` (rebuilt after each acceptance or absorption). */
export function ownerOf(s: DriverState, a: Addr): Addr | undefined {
  if (s.ownerIndex === undefined) {
    s.ownerIndex = intervalIndex(s.order.map((e) => {
      const r = s.funcs.get(e)?.reading;
      return { start: e, end: r === undefined ? e : extentEndOf(s, r), value: e };
    }));
  }
  return innermost(s.ownerIndex, a)?.value;
}

/** Streams a trail event when the options' level and filter keep it. */
export function emit(s: DriverState, kind: TrailKind, at: Addr, rule: RuleId, cites: readonly Addr[], detail?: string): void {
  if (s.sink === undefined || s.options.trail === 'off') return;
  const e = { kind, at, rule, round: s.round, cites: capCites(cites), ...(detail === undefined ? {} : { detail }) };
  if (trailKeeps(s.options.trail, s.options.trailFilter, e)) s.sink.event(e);
}

/** Records a rejection: the last one per (at, mode), with a count. */
export function reject(s: DriverState, at: Addr, mode: Mode, rule: RuleId, reason: MissReason, intrinsic: boolean, detail: string): void {
  const key = `${at}:${mode}`;
  const count = (s.rejections.get(key)?.count ?? 0) + 1;
  s.rejections.set(key, { at, mode, rule, reason, intrinsic, round: s.round, detail, count });
  emit(s, 'reject', at, rule, [at], `${reason}: ${detail}`);
}

/** Records a proposal of an entry that is already accepted. */
export function also(s: DriverState, c: Candidate): void {
  const f = s.funcs.get(c.entry);
  if (f === undefined || f.accepted.rule === c.proposedBy || f.also.some((p) => p.rule === c.proposedBy)) return;
  f.also.push({ rule: c.proposedBy, round: s.round, cites: capCites(c.cites) });
}

/** The view rules read, over the live state; `get` returns the driver state once it is built. */
export function makeView(get: () => DriverState): AnalysisView {
  return {
    get rom(): Rom {
      return get().rom;
    },
    get profile(): CompilerProfile {
      return get().profile;
    },
    get addresses(): AddressMap {
      return get().addresses;
    },
    get round(): number {
      return get().round;
    },
    get epoch(): number {
      return get().epoch;
    },
    get seeds(): readonly Seed[] {
      return get().options.seeds;
    },
    get overrides(): readonly OverrideFact[] {
      return get().options.overrides;
    },
    get pointers(): PointerIndex {
      return get().pointers;
    },
    claimAt: (a) => claimAt(get(), a),
    owner: (a) => {
      const s = get();
      const e = ownerOf(s, a);
      return e === undefined ? undefined : factOf(s, e);
    },
    isFunction: (a) => isFunction(get(), a),
    functions: () => get().order.slice(),
    accepted: (entry) => get().funcs.get(entry)?.reading,
    read: (entry, mode) => get().services.read(entry, mode),
    valid: (entry) => get().services.valid(entry),
    whyInvalid: (entry) => get().services.whyInvalid(entry),
    neverValid: (entry) => get().neverValid.has(entry),
    inProgress: (entry) => get().inProgress.has(entry),
    adrOwner: (a) => get().adrOwner.get(a),
  };
}
