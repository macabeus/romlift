// Readings (the PoC's settle() and analyzeArm()): a Thumb entry is walked until its bl verdicts are a
// fixpoint, memoised for the epoch; an ARM entry is walked afresh at every read, as the PoC does. Every
// read is a PoC call site, so it goes through the oracle (oracle.ts).
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import { sortedEntries, sortedKeys } from '../../../foundation/util/sorted.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { LIMITS, settleLimit } from '../limits.ts';
import { consult } from '../oracle.ts';
import type { BlSite, BlVerdict, BlVerdictRecord, Reading, WalkDecision } from '../types.ts';
import { walkArm } from '../walk/arm.ts';
import { walkThumb } from '../walk/thumb.ts';
import { beginReading, endReading, readReading, takeCarried } from './reuse.ts';
import { emit } from './view.ts';
import type { DriverState } from './view.ts';

/** The reading of `entry` in `mode`, as the view serves it. */
export function read(s: DriverState, entry: Addr, mode: Mode): Reading {
  return mode === 'thumb' ? settle(s, entry) : analyzeArm(s, entry);
}

/** The reading last computed for (entry, mode), without walking or asking the oracle (D56). */
export function peek(s: DriverState, entry: Addr, mode: Mode): Reading | undefined {
  if (mode === 'arm') return s.lastArm.get(entry) ?? s.funcs.get(entry)?.reading;
  return s.settled.get(entry) ?? s.funcs.get(entry)?.reading;
}

/** The PoC's analyzeArm(entry): a fresh walk. */
export function analyzeArm(s: DriverState, entry: Addr): Reading {
  const r = consult(s.tuning.oracle, { method: 'analyzeArm', entry }, () => walkArm(s.walkEnv, entry));
  s.lastArm.set(entry, r);
  return r;
}

/** The PoC's settle(entry).f. */
export function settle(s: DriverState, entry: Addr): Reading {
  const r = consult(s.tuning.oracle, { method: 'settle', entry }, () => settleNow(s, entry));
  if (!s.settled.has(entry)) s.settled.set(entry, r);
  return r;
}

/** The first verdict rule's answer for a site. */
function verdictOf(s: DriverState, site: BlSite, caller: Reading): { readonly verdict: BlVerdict | 'defer'; readonly rule?: RuleId } {
  for (const { id, rule } of s.rules.blVerdict) {
    const answer = rule.decide(site, caller, s.view);
    if (answer !== undefined) return { verdict: answer, rule: id };
  }
  return { verdict: 'defer' };
}

/** The first refinement that says the call never returns. */
function refinement(s: DriverState, site: BlSite, caller: Reading): RuleId | undefined {
  for (const { id, rule } of s.rules.blRefine) if (rule.decide(site, caller, s.view) === 'noreturn') return id;
  return undefined;
}

/** The per-function bl fixpoint, with `inProgress` guarding recursion through callees. */
function settleNow(s: DriverState, entry: Addr): Reading {
  const got = s.settled.get(entry) ?? carried(s, entry);
  if (got !== undefined) {
    if (s.reuse !== undefined) readReading(s.reuse, entry, s.funcs.has(entry));
    return got;
  }
  if (s.reuse !== undefined) beginReading(s.reuse);
  s.inProgress.add(entry);
  const far = new Set<Addr>();
  const noret = new Map<Addr, RuleId>();
  const calls = new Set<Addr>();
  const verdicts = new Map<Addr, BlVerdictRecord>();
  const record = (site: BlSite, verdict: BlVerdict, rule: RuleId): void => {
    if (verdicts.get(site.site)?.verdict === verdict) return;
    verdicts.set(site.site, { site: site.site, target: site.target, verdict, rule });
    emit(s, 'verdict', site.site, rule, [site.site, site.target], verdict);
  };
  // Traced, the walk-slot answers of every round are kept: an earlier round's answer (a noreturn call
  // before non-code, the padding dropped before it) decides a verdict that the last walk only applies.
  const steps: WalkDecision[] = [];
  const seen = new Set<string>();
  const keepSteps = (walked: Reading): void => {
    for (const st of walked.steps) {
      const key = `${st.at}:${st.rule}:${st.step}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(st);
    }
  };
  let r = walkThumb(s.walkEnv, entry, far, noret);
  keepSteps(r);
  let settled = false;
  for (let round = 0; round < LIMITS.settleRounds; round++) {
    if (round > 0) {
      r = walkThumb(s.walkEnv, entry, far, noret);
      keepSteps(r);
    }
    let changed = false;
    const deadEnd = new Set(r.deadEnd);
    for (const site of r.blSites) {
      // A call stays a call (its record, possibly refined to noreturn, is kept).
      const { verdict, rule } = calls.has(site.site) ? { verdict: 'call' as const, rule: undefined } : verdictOf(s, site, r);
      if (verdict === 'far' && rule !== undefined) {
        far.add(site.site);
        record(site, 'far', rule);
        changed = true;
        continue;
      }
      if (verdict === 'call' && rule !== undefined) {
        calls.add(site.site);
        record(site, 'call', rule);
      } else if (verdict === 'defer' && rule !== undefined && !verdicts.has(site.site)) record(site, 'call', rule);
      if (deadEnd.has(site.site) && !noret.has(site.site)) {
        const refined = refinement(s, site, r);
        if (refined !== undefined) {
          noret.set(site.site, refined);
          record(site, 'noreturn', refined);
          changed = true;
        }
      }
    }
    if (!changed) {
      settled = true;
      break;
    }
  }
  if (!settled && !s.diagnostics.some((d) => d.code === 'W_SETTLE_LIMIT' && d.addr === entry)) s.diagnostics.push(settleLimit(entry, LIMITS.settleRounds));
  s.inProgress.delete(entry);
  // The verdicts change no instruction, pool or table of the last walk: only its call list and records.
  const final: Reading = {
    ...r,
    calls: far.size === 0 ? r.calls : r.calls.filter((c) => !far.has(c.site)),
    far: sortedKeys(far),
    noret: sortedKeys(noret),
    blVerdicts: sortedEntries(verdicts).map(([, v]) => v),
    steps: steps.length === 0 ? r.steps : steps,
  };
  s.settled.set(entry, final);
  if (s.reuse !== undefined) endReading(s.reuse, entry);
  return final;
}

/** 'epoch-reuse': the reading carried over an epoch boundary, when every fact it read still holds. */
function carried(s: DriverState, entry: Addr): Reading | undefined {
  if (s.reuse === undefined) return undefined;
  const r = takeCarried(s.reuse, entry, s.inProgress);
  if (r !== undefined) s.settled.set(entry, r);
  return r;
}
