// Rule identity and metadata (architecture §3.1, D7). A rule id names its family before the dot; the
// metadata lives in each rule file next to its code, and the order rules run in lives only in the
// compiler profile's pipeline (core/profile/types.ts).
import type { Origin } from './vocabulary.ts';

/** The rule families: eight analysis families and the signature placement rules (§4.1, §7). */
export type Family = 'seed' | 'walk' | 'bl' | 'valid' | 'accept' | 'gap' | 'claim' | 'region' | 'sig';

/** Every family, in the order §4.1 lists them. */
export const FAMILIES: readonly Family[] = ['seed', 'walk', 'bl', 'valid', 'accept', 'gap', 'claim', 'region', 'sig'];

/** A rule id: `<family>.<name>`, e.g. 'valid.dense'. */
export type RuleId = `${Family}.${string}`;

/** What a rule reads from the analysis state or adds to it (the plan: "each pass declares what it reads … and what it adds"). */
export type Fact =
  | 'rom'
  | 'claims'
  | 'function-set'
  | 'readings'
  | 'validity'
  | 'pointer-index'
  | 'bl-verdicts'
  | 'exits'
  | 'candidates'
  | 'regions'
  | 'placements';

/** The metadata every rule carries in its own file. */
export interface RuleMeta {
  readonly id: RuleId;
  /** One line, printed by explain. */
  readonly summary: string;
  /** The compiler or hand-written behaviour it relies on (the plan's "Why it holds"). */
  readonly restsOn: string;
  /** What it prevents or recovers. */
  readonly recovers: string;
  readonly reads: readonly Fact[];
  readonly adds: readonly Fact[];
  /** Seed and gap rules: the origin id of what they propose. */
  readonly origin?: Origin;
}

/** The family a rule id belongs to. */
export function familyOf(id: RuleId): Family {
  const dot = id.indexOf('.');
  return id.slice(0, dot) as Family;
}

/** Whether `text` is a well-formed rule id of a known family. */
export function isRuleId(text: string): text is RuleId {
  const dot = text.indexOf('.');
  if (dot <= 0 || dot === text.length - 1) return false;
  return (FAMILIES as readonly string[]).includes(text.slice(0, dot));
}
