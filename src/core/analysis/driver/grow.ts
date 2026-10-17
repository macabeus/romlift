// grow() (the PoC's grow): its own until-stable loop; each round is an epoch, takes one snapshot of the
// harvest slot (pointerCandidates), and accepts the candidates that are valid and that an accept rule
// takes (acceptable).
import type { Addr } from '../../../foundation/rom/span.ts';
import type { Provenance } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { candidateBudget, fixpointLimit, LIMITS } from '../limits.ts';
import { consult } from '../oracle.ts';
import { Claim } from '../types.ts';
import type { Candidate, Reading } from '../types.ts';
import { accept } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { settle } from './settle.ts';
import { valid } from './validity.ts';
import { claimAt, reject } from './view.ts';
import type { DriverState } from './view.ts';

/** The PoC's pointerCandidates(): one list per harvest slot, each sorted, from one snapshot. */
export function pointerCandidates(s: DriverState): readonly (readonly Addr[])[] {
  const answer = consult(s.tuning.oracle, { method: 'pointerCandidates' }, () => {
    const lists: (readonly Addr[])[] = [];
    const earlier = new Set<Addr>();
    for (const id of s.profile.pipeline.harvest) {
      const rule = s.rules.harvest.find((h) => h.id === id)?.rule;
      const list = rule === undefined ? [] : rule.harvest(s.view, earlier);
      for (const a of list) earlier.add(a);
      lists.push(list);
    }
    return { pool: lists[0] ?? [], data: lists[1] ?? [] };
  });
  return [answer.pool, answer.data];
}

/** The PoC's acceptable(f, why): the first accept rule that holds, with its provenance. */
export function acceptable(s: DriverState, c: Candidate, r: Reading, index: number): Provenance | undefined {
  let taken: Provenance | undefined;
  const why = index === 0 ? 'pool pointer' : 'data pointer';
  const ok = consult(s.tuning.oracle, { method: 'acceptable', entry: c.entry, why }, () => {
    for (const { rule } of s.rules.accept) {
      taken = rule.holds(c, r, s.view);
      if (taken !== undefined) return true;
    }
    return false;
  });
  if (!ok) return undefined;
  return taken ?? { rule: c.proposedBy, round: s.round, cites: c.cites, note: 'acceptable (oracle)' };
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
    const count = lists.reduce((n, l) => n + l.length, 0);
    if (count > LIMITS.candidateBudget) s.diagnostics.push(candidateBudget(s.round, count, LIMITS.candidateBudget));
    let added = 0;
    lists.forEach((list, index) => {
      const proposedBy: RuleId = s.profile.pipeline.harvest[index] ?? 'seed.data-pointer';
      for (const t of list) {
        if (s.funcs.has(t) || claimAt(s, t) !== Claim.free || !valid(s, t)) continue;
        const r = settle(s, t);
        const c: Candidate = { entry: t, mode: 'thumb', proposedBy, cites: [t] };
        const taken = acceptable(s, c, r, index);
        if (taken !== undefined) added += accept(s, c, `accepted by ${taken.rule}`);
        else {
          const prologue = s.profile.idioms.isPrologue(s.rom, t, 'thumb');
          const last = s.rules.accept[s.rules.accept.length - 1]?.id ?? proposedBy;
          reject(s, t, 'thumb', last, 'unanchored', false, `valid, referenced by ${proposedBy}, but no anchor${prologue ? '' : ' and no push {.., lr}'}`);
        }
      }
    });
    total += added;
    if (added === 0) return total;
  }
}
