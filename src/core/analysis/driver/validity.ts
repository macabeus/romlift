// Validity (the PoC's valid() and whyInvalid()): the validity slot in order, the first failure being the
// rejection. valid() memoises optimistically (true while the callees are checked), so mutual recursion
// through valid.calls-code terminates; an intrinsic failure is remembered for the whole analysis
// (neverValid), a 'calls-non-code' failure only for the epoch.
import type { Addr } from '../../../foundation/rom/span.ts';
import { consult } from '../oracle.ts';
import { Claim } from '../types.ts';
import type { ValidityFailure } from '../types.ts';
import { read } from './settle.ts';
import { claimAt, isFunction, reject } from './view.ts';
import type { DriverState } from './view.ts';

/** The PoC's whyInvalid(entry): the first failing validity rule, computed now; pure but for the readings it takes. */
export function whyInvalid(s: DriverState, entry: Addr): ValidityFailure | undefined {
  const answer = consult(s.tuning.oracle, { method: 'whyInvalid', entry }, () => firstFailure(s, entry) ?? null);
  return answer ?? undefined;
}

function firstFailure(s: DriverState, entry: Addr): ValidityFailure | undefined {
  let reading;
  for (const { id, rule } of s.rules.validity) {
    let detail: string | undefined;
    if (rule.checkEntry !== undefined) detail = rule.checkEntry(entry, s.view);
    else {
      reading ??= read(s, entry, 'thumb');
      detail = rule.check(reading, s.view);
    }
    if (detail !== undefined) return { rule: id, reason: rule.reason, intrinsic: rule.intrinsic, detail };
  }
  return undefined;
}

/** The PoC's valid(entry): memoised validity of a Thumb entry, as the fixpoint uses it. */
export function valid(s: DriverState, entry: Addr): boolean {
  return consult(s.tuning.oracle, { method: 'valid', entry }, () => validNow(s, entry));
}

function validNow(s: DriverState, entry: Addr): boolean {
  if (isFunction(s, entry)) return true;
  if (s.neverValid.has(entry)) return false;
  const memo = s.validMemo.get(entry);
  if (memo !== undefined) return memo;
  if (entry < s.rom.base || entry >= s.rom.end || (entry & 1) !== 0 || claimAt(s, entry) !== Claim.free) {
    s.neverValid.add(entry);
    return false;
  }
  s.validMemo.set(entry, true); // optimistic while callees are checked
  const failure = whyInvalid(s, entry);
  if (failure !== undefined) {
    reject(s, entry, 'thumb', failure.rule, failure.reason, failure.intrinsic, failure.detail);
    if (failure.intrinsic) s.neverValid.add(entry);
  }
  s.validMemo.set(entry, failure === undefined);
  return failure === undefined;
}
