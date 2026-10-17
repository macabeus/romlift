// The driver's records of what the rules decided: trail events (streamed to the sink when the options
// keep them), rejections (the last per (at, mode), with a count) and later proposals of an accepted entry.
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import { capCites } from '../../provenance/provenance.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { trailKeeps } from '../../provenance/trail.ts';
import type { TrailKind } from '../../provenance/trail.ts';
import type { MissReason } from '../../provenance/vocabulary.ts';
import type { Candidate } from '../types.ts';
import type { DriverState } from './state.ts';

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

