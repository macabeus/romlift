// Epochs (architecture §4.2, D13): one begins at every grow round and every fillGaps call, where the PoC
// calls forgetCandidates(). Within an epoch a reading or a validity verdict, once computed, is reused
// even after later acceptances; at the boundary the readings of entries not accepted and the validity
// memo are dropped, while intrinsic failures and accepted readings stay. Under 'epoch-reuse' (milestone
// M2, reuse.ts) a dropped Thumb reading is carried, to be served again while its facts still hold.
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import { carry } from './reuse.ts';
import type { DriverState } from './state.ts';

/** Starts a new epoch. */
export function beginEpoch(s: DriverState): void {
  s.epoch += 1;
  s.validMemo = new Map();
  for (const entry of sortedKeys(s.settled)) {
    if (s.funcs.has(entry)) continue;
    const r = s.settled.get(entry);
    if (s.reuse !== undefined && r !== undefined) carry(s.reuse, entry, r);
    s.settled.delete(entry);
  }
  s.lastArm.clear();
}
