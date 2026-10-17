// Epochs (architecture §4.2, D13): one begins at every grow round and every fillGaps call, where the PoC
// calls forgetCandidates(). Within an epoch a reading or a validity verdict, once computed, is reused
// even after later acceptances; at the boundary the readings of entries not accepted and the validity
// memo are dropped, while intrinsic failures and accepted readings stay. 'epoch-reuse' (milestone M2,
// only if a ROM misses the budget) is not built yet and behaves as 'epoch'.
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import type { DriverState } from './view.ts';

/** Starts a new epoch. */
export function beginEpoch(s: DriverState): void {
  s.epoch += 1;
  s.tuning.oracle?.marker({ kind: 'forgetCandidates', epoch: s.epoch });
  s.validMemo = new Map();
  for (const entry of sortedKeys(s.settled)) if (!s.funcs.has(entry)) s.settled.delete(entry);
  s.lastArm.clear();
}
