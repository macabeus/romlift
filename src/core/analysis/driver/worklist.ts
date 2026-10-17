// The candidate worklist of accept() (architecture §4.4, D10). 'poc-lifo' pops the last pushed candidate,
// as the PoC's work.pop(); it exists only until milestone M4. 'ascending' pops the least key
// (addr, Thumb before ARM, the proposing rule's rank in its slot, the proposal counter), a total order.
import { compareWorkKeys, minHeap } from '../../../foundation/util/min-heap.ts';
import type { WorkKey } from '../../../foundation/util/min-heap.ts';
import type { Candidate } from '../types.ts';
import type { RuleId } from '../../provenance/rule-id.ts';

export interface Worklist {
  push(c: Candidate): void;
  pop(): Candidate | undefined;
}

/** The PoC's LIFO. */
export function pocLifo(): Worklist {
  const items: Candidate[] = [];
  return { push: (c) => void items.push(c), pop: () => items.pop() };
}

/** The ascending worklist; `rank` is each rule's index in its pipeline slot. */
export function ascending(rank: ReadonlyMap<RuleId, number>, nextSeq: () => number): Worklist {
  const heap = minHeap<{ readonly key: WorkKey; readonly c: Candidate }>((a, b) => compareWorkKeys(a.key, b.key));
  return {
    push(c) {
      heap.push({ key: { addr: c.entry, modeRank: c.mode === 'thumb' ? 0 : 1, ruleRank: rank.get(c.proposedBy) ?? 0, seq: nextSeq() }, c });
    },
    pop: () => heap.pop()?.c,
  };
}
