// The 'epoch-reuse' cache (architecture §4.2, D13, milestone M2 step (c)): a Thumb reading of an entry
// that is not accepted may be carried across an epoch boundary when every fact it read is unchanged, so
// it equals the reading a fresh walk would compute. 'epoch' stays the production mode; this mode is
// internal and must give the same digests (test/local/epoch-reuse.test.ts).
//
// What a reading reads, through the view, while settle() computes it: isFunction and claimAt of
// addresses (recorded as 64-byte pages), inProgress of entries (recorded with the answer), and the
// readings of its callees (their entry's page, and their own facts merged in, with the oldest stamp).
// Any other view query during the computation makes the reading opaque: it is never carried. Every
// change of a fact touches its pages with a new stamp: a claim write, an accepted entry, and a block
// absorbed into an accepted function (which changes that function's reading). A carried reading is
// served again only when none of its pages was touched after its stamp and every inProgress answer is
// still the same.
import type { Addr } from '../../../foundation/rom/span.ts';
import { sortedEntries, sortedKeys } from '../../../foundation/util/sorted.ts';
import type { Reading } from '../types.ts';

const PAGE_BITS = 6;

/** The facts one reading read, and the stamp they were read at (the oldest of its callees'). */
export interface ReadingFacts {
  readonly stamp: number;
  /** Ascending, unique. */
  readonly pages: readonly number[];
  /** By entry, ascending. */
  readonly inProgress: readonly (readonly [Addr, boolean])[];
  readonly opaque: boolean;
}

/** The facts of a reading being computed. */
interface Recording {
  stamp: number;
  readonly pages: Set<number>;
  /** The page added last: a walk reads the same page many times in a row. */
  last: number;
  readonly inProgress: Map<Addr, boolean>;
  opaque: boolean;
}

export interface ReuseState {
  /** The stamp of the last change, and the stamp of the last change of each page. */
  stamp: number;
  readonly touched: Uint32Array;
  readonly base: Addr;
  /** The facts of the readings being computed, innermost last. */
  readonly stack: Recording[];
  /** The facts of each Thumb reading of the current epoch that is not accepted. */
  readonly facts: Map<Addr, ReadingFacts>;
  /** The readings carried over the last epoch boundaries, with their facts. */
  readonly carried: Map<Addr, { readonly reading: Reading; readonly facts: ReadingFacts }>;
}

export function reuseState(base: Addr, size: number): ReuseState {
  return { stamp: 0, touched: new Uint32Array((size >>> PAGE_BITS) + 1), base, stack: [], facts: new Map(), carried: new Map() };
}

/** The page of `a`, or -1 outside the ROM. */
function pageOf(r: ReuseState, a: Addr): number {
  const k = a - r.base;
  return k >= 0 && k < r.touched.length << PAGE_BITS && Number.isInteger(k) ? k >>> PAGE_BITS : -1;
}

/** A fact changed for the addresses [start, end): touch their pages. */
export function touch(r: ReuseState, start: Addr, end: Addr): void {
  r.stamp += 1;
  const lo = pageOf(r, Math.max(start, r.base));
  const hi = pageOf(r, Math.max(start, end - 1));
  if (lo < 0) return;
  for (let p = lo; p <= (hi < 0 ? r.touched.length - 1 : hi); p++) r.touched[p] = r.stamp;
}

/** The reading being computed read a fact of address `a`. */
export function readAddr(r: ReuseState, a: Addr): void {
  const top = r.stack[r.stack.length - 1];
  if (top === undefined) return;
  const p = pageOf(r, a);
  if (p === top.last) return;
  if (p < 0) top.opaque = true;
  else top.pages.add(p);
  top.last = p;
}

/** The reading being computed asked whether `entry` is being settled, and got `answer`. */
export function readInProgress(r: ReuseState, entry: Addr, answer: boolean): void {
  const top = r.stack[r.stack.length - 1];
  if (top !== undefined && top.inProgress.get(entry) !== answer) {
    if (top.inProgress.has(entry)) top.opaque = true;
    else top.inProgress.set(entry, answer);
  }
}

/** The reading being computed asked the view something this cache does not track. */
export function readOpaque(r: ReuseState): void {
  const top = r.stack[r.stack.length - 1];
  if (top !== undefined) top.opaque = true;
}

function merge(into: Recording, from: ReadingFacts): void {
  into.stamp = Math.min(into.stamp, from.stamp);
  for (const p of from.pages) into.pages.add(p);
  for (const [entry, answer] of from.inProgress) {
    const had = into.inProgress.get(entry);
    if (had === undefined) into.inProgress.set(entry, answer);
    else if (had !== answer) into.opaque = true;
  }
  if (from.opaque) into.opaque = true;
}

/** The reading being computed was served the reading of `entry`; `facts` are that reading's, unless it is accepted. */
export function readReading(r: ReuseState, entry: Addr, accepted: boolean): void {
  const top = r.stack[r.stack.length - 1];
  if (top === undefined) return;
  readAddr(r, entry);
  if (accepted) return;
  const facts = r.facts.get(entry);
  if (facts === undefined) top.opaque = true;
  else merge(top, facts);
}

/** Starts recording the facts of a reading computed now. */
export function beginReading(r: ReuseState): void {
  r.stack.push({ stamp: r.stamp, pages: new Set(), last: -2, inProgress: new Map(), opaque: false });
}

/** Ends the recording of the reading of `entry`, keeps its facts and merges them into the reading that asked for it. */
export function endReading(r: ReuseState, entry: Addr): void {
  const recording = r.stack.pop();
  if (recording === undefined) return;
  const facts: ReadingFacts = {
    stamp: recording.stamp,
    pages: sortedKeys(recording.pages),
    inProgress: sortedEntries(recording.inProgress),
    opaque: recording.opaque,
  };
  r.facts.set(entry, facts);
  const parent = r.stack[r.stack.length - 1];
  if (parent !== undefined) {
    parent.pages.add(pageOf(r, entry));
    merge(parent, facts);
  }
}

/** Whether facts read at their stamp still hold: no page touched since, every inProgress answer the same. */
export function stillHolds(r: ReuseState, facts: ReadingFacts, inProgress: ReadonlySet<Addr>): boolean {
  if (facts.opaque) return false;
  for (const p of facts.pages) if ((r.touched[p] ?? 0) > facts.stamp) return false;
  for (const [entry, answer] of facts.inProgress) if (inProgress.has(entry) !== answer) return false;
  return true;
}

/** At an epoch boundary: keeps the reading of an entry that is not accepted, with its facts, unless it is opaque. */
export function carry(r: ReuseState, entry: Addr, reading: Reading): void {
  const facts = r.facts.get(entry);
  r.facts.delete(entry);
  if (facts !== undefined && !facts.opaque) r.carried.set(entry, { reading, facts });
}

/** The carried reading of `entry` when its facts still hold; it then belongs to the current epoch again. */
export function takeCarried(r: ReuseState, entry: Addr, inProgress: ReadonlySet<Addr>): Reading | undefined {
  const c = r.carried.get(entry);
  if (c === undefined) return undefined;
  r.carried.delete(entry);
  if (!stillHolds(r, c.facts, inProgress)) return undefined;
  r.facts.set(entry, c.facts);
  return c.reading;
}
