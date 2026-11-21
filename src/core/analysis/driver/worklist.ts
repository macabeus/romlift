// The candidate worklist of accept() (architecture §4.4, D10): it pops the least key (addr, Thumb before
// ARM, the proposing rule's rank in its slot, the proposal counter), a total order. The PoC's LIFO
// ('poc-lifo') was deleted by the phase-2 integration (c608a33), and the lockstep oracle that replayed it
// in the fix round of phase 2 (D59).
import { compareWorkKeys, minHeap } from '../../../foundation/util/min-heap.ts';
import type { WorkKey } from '../../../foundation/util/min-heap.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import type { Candidate } from '../types.ts';

/** What accept() pushes and pops. */
export interface Worklist {
  push(c: Candidate): void;
  pop(): Candidate | undefined;
}

/** The ascending worklist; `rank` is each rule's index in its pipeline slot. */
export function ascending(rank: ReadonlyMap<RuleId, number>, nextSeq: () => number): Worklist {
  const heap = minHeap<{ readonly key: WorkKey; readonly c: Candidate }>((a, b) => compareWorkKeys(a.key, b.key));
  return {
    push(c) {
      heap.push({
        key: {
          addr: c.entry,
          modeRank: c.mode === 'thumb' ? 0 : 1,
          ruleRank: rank.get(c.proposedBy) ?? 0,
          seq: nextSeq(),
        },
        c,
      });
    },
    pop: () => heap.pop()?.c,
  };
}
