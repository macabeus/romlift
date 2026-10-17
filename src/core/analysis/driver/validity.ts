// Validity (the PoC's valid() and whyInvalid()): the validity slot in order, the first failure being the
// rejection. valid() memoises optimistically (true while the callees are checked), so mutual recursion
// through valid.calls-code terminates; an intrinsic failure is remembered for the whole analysis
// (neverValid), a 'calls-non-code' failure only for the epoch. An entry outside the ROM, odd or claimed is
// judged by the slot too (valid.in-rom-unclaimed's checkEntry, before any reading), so its rejection
// names that rule and disabling it changes the verdict.
import type { Addr } from '../../../foundation/rom/span.ts';
import type { ValidityFailure } from '../types.ts';
import { read } from './settle.ts';
import { isFunction } from './state.ts';
import type { DriverState } from './state.ts';
import { reject } from './trail.ts';

/** The PoC's whyInvalid(entry): the first failing validity rule, computed now; pure but for the readings it takes. */
export function whyInvalid(s: DriverState, entry: Addr): ValidityFailure | undefined {
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
  if (isFunction(s, entry)) return true;
  if (s.neverValid.has(entry)) return false;
  const memo = s.validMemo.get(entry);
  if (memo !== undefined) return memo;
  s.validMemo.set(entry, true); // optimistic while callees are checked
  const failure = whyInvalid(s, entry);
  if (failure !== undefined) {
    reject(s, entry, 'thumb', failure.rule, failure.reason, failure.intrinsic, failure.detail);
    if (failure.intrinsic) s.neverValid.add(entry);
  }
  s.validMemo.set(entry, failure === undefined);
  return failure === undefined;
}
