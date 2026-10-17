// The decision trail (architecture §9.2): what the analysis proposed, accepted, rejected, waited on,
// absorbed, decided ('verdict': a bl site, a walk-slot answer of an accepted reading, the gap's
// Thumb/ARM choice or skip), claimed, or (phase 6) placed. Core has no logger; it streams events to an
// optional sink when the trail level is not 'off'.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import type { RuleId } from './rule-id.ts';

export type TrailKind = 'propose' | 'accept' | 'reject' | 'wait' | 'absorb' | 'verdict' | 'claim' | 'place';

export interface TrailEvent {
  readonly kind: TrailKind;
  readonly at: Addr;
  readonly rule: RuleId;
  readonly round: number;
  /** At most four addresses the decision read (MAX_CITES). */
  readonly cites: readonly Addr[];
  readonly detail?: string;
}

export interface TrailSink {
  event(e: TrailEvent): void;
}

/** 'decisions' keeps what changed the result; 'full' adds every proposal and every wait. */
export type TrailLevel = 'off' | 'decisions' | 'full';

/** The kinds a 'decisions' trail keeps. */
const DECISION_KINDS: ReadonlySet<TrailKind> = new Set<TrailKind>(['accept', 'reject', 'absorb', 'verdict', 'claim', 'place']);

/** Whether a trail of `level`, filtered to `filter` when given, keeps `e`: its address or one of its cites lies in the filter. */
export function trailKeeps(level: TrailLevel, filter: Span | undefined, e: TrailEvent): boolean {
  if (level === 'off') return false;
  if (level === 'decisions' && !DECISION_KINDS.has(e.kind)) return false;
  if (filter === undefined) return true;
  const inside = (a: Addr): boolean => a >= filter.start && a < filter.end;
  return inside(e.at) || e.cites.some(inside);
}
