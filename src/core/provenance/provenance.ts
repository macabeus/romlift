// What a rule decided and why (architecture §3.1, D6): the provenance of an accepted function and the
// rejection kept for a candidate. Both are plain data; `cites` holds at most MAX_CITES addresses the
// decision read, so provenance never grows with the size of a function (§9.4).
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import type { RuleId } from './rule-id.ts';
import type { MissReason } from './vocabulary.ts';

/** The most addresses a provenance or a trail event cites. */
export const MAX_CITES = 4;

export interface Provenance {
  readonly rule: RuleId;
  /** The driver round the decision was taken in. */
  readonly round: number;
  /** At most MAX_CITES addresses the decision read. */
  readonly cites: readonly Addr[];
  readonly note?: string;
}

/** The last rejection of a candidate, per (at, mode), with how many times it was rejected. */
export interface Rejection {
  readonly at: Addr;
  readonly mode: Mode;
  readonly rule: RuleId;
  readonly reason: MissReason;
  /** True: the failure cannot change later, so it is memoised for the whole analysis. */
  readonly intrinsic: boolean;
  readonly round: number;
  readonly detail: string;
  readonly count: number;
}

/** The first MAX_CITES distinct addresses of `cites`, in their order. */
export function capCites(cites: readonly Addr[]): readonly Addr[] {
  const out: Addr[] = [];
  for (const a of cites) {
    if (out.length === MAX_CITES) break;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** Builds a provenance record with its cites capped. */
export function provenance(rule: RuleId, round: number, cites: readonly Addr[], note?: string): Provenance {
  return { rule, round, cites: capCites(cites), ...(note === undefined ? {} : { note }) };
}

/** Orders rejections by address, then Thumb before ARM. */
export function compareRejections(a: Rejection, b: Rejection): number {
  if (a.at !== b.at) return a.at - b.at;
  return a.mode === b.mode ? 0 : a.mode === 'thumb' ? -1 : 1;
}
