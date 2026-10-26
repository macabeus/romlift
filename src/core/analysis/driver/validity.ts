// Validity (the PoC's valid() and whyInvalid()): the validity slot in order, the first failure being the
// rejection. valid() memoises optimistically (true while the callees are checked), so mutual recursion
// through valid.calls-code terminates; an intrinsic failure is remembered for the whole analysis
// (neverValid), a 'calls-non-code' failure only for the epoch. An entry outside the ROM, odd or claimed is
// judged by the slot too (valid.in-rom-unclaimed's checkEntry, before any reading), so its rejection
// names that rule and disabling it changes the verdict.
import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import type { Reading, ValidityFailure } from '../types.ts';
import { read } from './settle.ts';
import { isFunction } from './state.ts';
import type { DriverState } from './state.ts';
import { reject } from './trail.ts';

/** The PoC's whyInvalid(entry): the first failing validity rule, computed now; pure but for the readings it takes. */
export function whyInvalid(s: DriverState, entry: Addr): ValidityFailure | undefined {
  return firstInvalid(s, entry, 'thumb', () => read(s, entry, 'thumb'));
}

/**
 * The first validity rule the code at `entry` in `mode` fails, `readingOf` called only when a rule needs the reading:
 * a Thumb entry is judged by a rule's `checkEntry` before any reading, as whyInvalid; an ARM one (a part of a listed
 * extent, listed-extent.ts) by every rule's `check` of its ARM reading.
 */
export function firstInvalid(s: DriverState, entry: Addr, mode: Mode, readingOf: () => Reading): ValidityFailure | undefined {
  let reading: Reading | undefined;
  for (const { id, rule } of s.rules.validity) {
    const detail = rule.checkEntry !== undefined && mode === 'thumb' ? rule.checkEntry(entry, s.view) : rule.check((reading ??= readingOf()), s.view);
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
