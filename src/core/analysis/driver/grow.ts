// grow() (the PoC's grow): its own until-stable loop; each round is an epoch, takes one snapshot of the
// harvest slot (pointerCandidates), and accepts the candidates that are valid and that an accept rule
// takes (acceptable). A valid candidate no accept rule takes is rejected as 'unanchored' under the rule
// that proposed it: the accept slot holds a rule's decision only when one of its rules took it.
import type { Addr } from '../../../foundation/rom/span.ts';
import type { Provenance } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { candidateBudget, fixpointLimit, LIMITS } from '../limits.ts';
import { Claim } from '../types.ts';
import type { Candidate, Reading } from '../types.ts';
import { accept } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { settle } from './settle.ts';
import { claimAt } from './state.ts';
import { emit, reject } from './trail.ts';
import type { DriverState } from './state.ts';
import { valid } from './validity.ts';

/** One harvest rule's list of a round: the rule and its targets, ascending. */
export interface Harvest {
  readonly id: RuleId;
  readonly targets: readonly Addr[];
}

/** The PoC's pointerCandidates(): one list per harvest rule of the slot, in slot order, from one snapshot. */
export function pointerCandidates(s: DriverState): readonly Harvest[] {
  const earlier = new Set<Addr>();
  return s.rules.harvest.map(({ id, rule }) => {
    const targets = rule.harvest(s.view, earlier);
    for (const a of targets) earlier.add(a);
    return { id, targets };
  });
}

/** The PoC's acceptable(f, why): the first accept rule that holds, with its provenance. */
export function acceptable(s: DriverState, c: Candidate, r: Reading): Provenance | undefined {
  for (const { rule } of s.rules.accept) {
    const taken = rule.holds(c, r, s.view);
    if (taken !== undefined) return taken;
  }
  return undefined;
}

/** The PoC's grow(): accepts harvest candidates until a round adds none; returns how many it added. */
export function grow(s: DriverState): number {
  let total = 0;
  for (let rounds = 0; ; rounds++) {
    if (rounds === LIMITS.fixpointRounds) {
      s.diagnostics.push(fixpointLimit('grow', rounds));
      return total;
    }
    s.round += 1;
    beginEpoch(s);
    const lists = pointerCandidates(s);
    const count = lists.reduce((n, l) => n + l.targets.length, 0);
    if (count > LIMITS.candidateBudget) s.diagnostics.push(candidateBudget(s.round, count, LIMITS.candidateBudget));
    let added = 0;
    for (const { id: proposedBy, targets } of lists) {
      for (const t of targets) {
        if (s.funcs.has(t) || claimAt(s, t) !== Claim.free || !valid(s, t)) continue;
        const r = settle(s, t);
        const c: Candidate = { entry: t, mode: 'thumb', proposedBy, cites: [t] };
        const taken = acceptable(s, c, r);
        if (taken !== undefined) {
          const n = accept(s, c, `accepted by ${taken.rule}`);
          // The accept rule decided: the accept event above names the proposer, this one the rule that took it.
          if (n > 0 && taken.rule !== proposedBy) emit(s, 'accept', t, taken.rule, taken.cites, `takes the ${proposedBy} candidate`);
          added += n;
        } else {
          const prologue = s.profile.idioms.isPrologue(s.rom, t, 'thumb');
          reject(s, t, 'thumb', proposedBy, 'unanchored', false, `valid, referenced by ${proposedBy}, but no accept rule takes it: no anchor${prologue ? '' : ' and no push {.., lr}'}`);
        }
      }
    }
    total += added;
    if (added === 0) return total;
  }
}
