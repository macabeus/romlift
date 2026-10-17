// Epochs (architecture §4.2, D13): one begins at every grow round and every fillGaps call, where the PoC
// calls forgetCandidates(). Within an epoch a reading or a validity verdict, once computed, is reused
// even after later acceptances; at the boundary the readings of entries not accepted and the validity
// memo are dropped, while intrinsic failures and accepted readings stay. Under 'epoch-reuse' (milestone
// M2, reuse.ts) a dropped Thumb reading is carried, to be served again while its facts still hold. The
// readings an epoch holds for entries not accepted are bounded by LIMITS.epochReadingBytes (hold).
import type { Addr } from '../../../foundation/rom/span.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import { LIMITS, readingBudget } from '../limits.ts';
import type { Reading } from '../types.ts';
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
  s.held = 0;
  s.lastArm.clear();
}

const PAGE_BITS = 12;

/**
 * An estimate of the bytes a reading holds: a fixed part, each instruction, and each 4 KiB page of its
 * instruction index (walk/insn-index.ts), the part that dominates for a walk scattered over data.
 */
export function readingBytes(r: Reading): number {
  let pages = 0;
  let last = -1;
  for (const i of r.insns) {
    const page = i.addr >>> PAGE_BITS;
    if (page !== last) pages += 1;
    last = page;
  }
  return 2048 + 64 * r.insns.length + (1 << PAGE_BITS) * pages;
}

/**
 * Keeps the Thumb reading of `entry` for the epoch. An entry not accepted counts against the reading
 * budget; past it every such reading is dropped (validity verdicts stay memoised) and W_READING_BUDGET
 * is raised once per run.
 */
export function hold(s: DriverState, entry: Addr, r: Reading, budget: number = LIMITS.epochReadingBytes): void {
  s.settled.set(entry, r);
  if (s.funcs.has(entry)) return;
  s.held += readingBytes(r);
  if (s.held <= budget) return;
  for (const e of sortedKeys(s.settled)) if (!s.funcs.has(e)) s.settled.delete(e);
  s.held = 0;
  if (!s.diagnostics.some((d) => d.code === 'W_READING_BUDGET')) s.diagnostics.push(readingBudget(s.round, budget));
}
