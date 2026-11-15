// The canonical pass (architecture §4.2, D114): after the passes, in both modes, every reading is made the one the
// final function set gives, so the analysis no longer depends on the order its functions were taken in.
//
// A reading is taken once, under the function set and the claims of that moment (a walk stops at an accepted
// function, and a branch to one or into code another function claimed is a tail exit). Discover accepts functions
// one at a time, so code that several entries share went to whichever was read first; confirm lists every entry from
// round 0, so it could read the same code differently (D61 e). The pass removes that history:
//
// - Labels and boundaries. An inner label is an entry strictly inside another function's extent (in confirm mode,
//   the listed `label = true` entries, which init writes from exactly that); every other entry is a boundary. In
//   discover mode the labels grow to a fixpoint: an entry a re-read extent now covers becomes a label too.
// - The canonical walk (view.isBoundary, view.boundaryBetween). A boundary function's walk stops when it falls into a
//   boundary entry and passes through inner labels; a branch is a tail exit when its target lies below the entry or
//   past another boundary entry, whatever the claims say. An inner label's own walk is bounded by every entry. Such a
//   reading depends on the ROM, the entries and the labels only: not on the claims, nor on the order.
// - Re-reading. A function is read again when its reading may differ under that walk (mayChange): it is an inner
//   label, a boundary or a label lies inside its code, a followed branch would now leave, a tail exit would now be
//   followed or would now name a function, or a far `bl` targets an entry. Every other reading already is canonical.
//   `tuning.canonicalSweep: 'full'` re-reads every function: the reference a test holds the selection to.
// - Claims are rebuilt from nothing, in ascending entry order, so no claim a replaced reading left survives.
//
// A reading whose shape does not change is kept as it is, with the provenance of its verdicts. The pass emits no
// trail event: what it decides is the final reading, which explain prints.
import type { Addr } from '../../../foundation/rom/span.ts';
import { lowerBound } from '../../../foundation/util/arrays.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import { fixpointLimit, LIMITS } from '../limits.ts';
import type { Reading } from '../types.ts';
import { Claim } from '../types.ts';
import { decodeArmAt } from '../walk/arm.ts';
import { decodeThumbAt } from '../walk/thumb.ts';
import { claim } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { extentEndOf } from './facts.ts';
import { analyzeArm, settle } from './settle.ts';
import type { DriverState } from './state.ts';

const NO_LABELS: ReadonlySet<Addr> = new Set();

/** What a reading decides that the pass compares: a reading of the same shape is kept as it is. */
function shape(r: Reading): string {
  return JSON.stringify([
    r.mode,
    r.insns.map((i) => [i.addr, i.len]),
    r.pools.map((p) => p.addr),
    r.codeEnd,
    r.end,
    r.far,
    r.calls.map((c) => [c.site, c.target]),
    r.exits.map((e) => [e.at, e.kind]),
  ]);
}

/** The entries strictly inside an earlier function's extent (entries ascending), as layout/entries.ts coveredEntries. */
export function insideOthers(s: DriverState, entries: readonly Addr[]): Set<Addr> {
  const out = new Set<Addr>();
  let reach = -Infinity;
  for (const e of entries) {
    if (e < reach) out.add(e);
    const r = s.funcs.get(e)?.reading;
    if (r !== undefined) reach = Math.max(reach, extentEndOf(s, r));
  }
  return out;
}

/** The labels the pass starts from: the listed ones in confirm mode, the covered entries in discover mode. */
function initialLabels(s: DriverState, entries: readonly Addr[]): Set<Addr> {
  if (s.options.mode !== 'confirm') return insideOthers(s, entries);
  const out = new Set<Addr>();
  for (const e of entries) if (s.listed.get(e)?.label === true) out.add(e);
  return out;
}

/** Whether some entry of `sorted` lies in (lo, hi]. */
function anyIn(sorted: readonly Addr[], lo: Addr, hi: Addr): boolean {
  const next = sorted[lowerBound(sorted, lo + 1, (x) => x)];
  return next !== undefined && next <= hi;
}

/** The entries of `sorted` in (lo, hi). */
function within(sorted: readonly Addr[], lo: Addr, hi: Addr): Addr[] {
  const out: Addr[] = [];
  for (let i = lowerBound(sorted, lo + 1, (x) => x); i < sorted.length; i++) {
    const a = sorted[i] as Addr;
    if (a >= hi) break;
    out.push(a);
  }
  return out;
}

/** The target of the branch at `at` in `r`'s mode, if it is one. */
function branchTarget(s: DriverState, r: Reading, at: Addr): Addr | undefined {
  const insn = r.mode === 'thumb' ? decodeThumbAt(s.walkEnv, at) : decodeArmAt(s.walkEnv, at);
  return insn.flow.kind === 'branch' ? insn.flow.target : undefined;
}

/** Whether the reading of a boundary function `r` may differ under the canonical walk (see the header). */
function mayChange(s: DriverState, r: Reading, labels: readonly Addr[], boundaries: readonly Addr[]): boolean {
  const e = r.entry;
  const end = Math.max(r.end, r.codeEnd);
  // A boundary inside its code (the walk passed it), or an inner label it reached or stopped at.
  for (const b of within(boundaries, e, end)) if (r.insnAt.has(b)) return true;
  if (anyIn(labels, e, end)) return true;
  // A followed branch that would now leave the function.
  for (const t of r.branchTargets) if (t !== e && (t < e || anyIn(boundaries, e, t))) return true;
  // A tail exit that would now be followed, or whose target is a function its calls do not name yet.
  for (const x of r.exits) {
    if (x.kind !== 'tail') continue;
    const t = branchTarget(s, r, x.at);
    if (t === undefined || t < s.rom.base || t >= s.rom.end) continue;
    if (t > e && !anyIn(boundaries, e, t) && !r.insnAt.has(t)) return true;
    if (s.funcs.has(t) && !r.calls.some((c) => c.site === x.at)) return true;
  }
  // A far bl to an entry, which the final function set makes a call.
  for (const t of r.far) if (s.funcs.has(t)) return true;
  return false;
}

/** Re-reads the selected functions under the current labels; returns how many readings changed. */
function sweep(s: DriverState, entries: readonly Addr[], labels: ReadonlySet<Addr>): number {
  const boundaries = entries.filter((e) => !labels.has(e));
  const labelList = entries.filter((e) => labels.has(e));
  const canonical = { labels, boundaries };
  const inner = { labels: NO_LABELS, boundaries: entries };
  const full = s.tuning.canonicalSweep === 'full';
  const selected = entries.filter((e) => {
    const f = s.funcs.get(e);
    if (f === undefined || f.absorbed.length > 0) return false;
    return full || labels.has(e) || mayChange(s, f.reading, labelList, boundaries);
  });
  // The readings of entries not accepted were taken under the old walk: none may be served again.
  beginEpoch(s);
  if (s.reuse !== undefined) {
    s.reuse.carried.clear();
    s.reuse.facts.clear();
  }
  for (const e of selected) s.settled.delete(e);
  let changed = 0;
  for (const e of selected) {
    const f = s.funcs.get(e);
    if (f === undefined) continue;
    s.canonical = labels.has(e) ? inner : canonical;
    const r = f.reading.mode === 'thumb' ? settle(s, e) : analyzeArm(s, e);
    s.canonical = canonical;
    if (shape(r) !== shape(f.reading)) {
      f.reading = r;
      changed += 1;
    }
    if (f.reading.mode === 'thumb') s.settled.set(e, f.reading);
  }
  s.ownerIndex = undefined;
  return changed;
}

/** Rebuilds every claim from nothing: the data overrides, then each function's reading in ascending entry order. */
function reclaim(s: DriverState, entries: readonly Addr[]): void {
  s.claims.fill(Claim.free);
  for (const d of s.dataOverrides) s.claims.fill(Claim.data, d.start - s.rom.base, d.end - s.rom.base);
  for (const e of entries) {
    const f = s.funcs.get(e);
    if (f !== undefined) claim(s, e, f.reading);
  }
  s.ownerIndex = undefined;
}

/** The canonical pass (see the header); the walk is the ordinary one again afterwards. */
export function canonicalize(s: DriverState): void {
  const entries = sortedKeys(s.funcs);
  if (entries.length === 0) return;
  s.muted = true;
  let labels = initialLabels(s, entries);
  for (let round = 0; ; round++) {
    if (round === LIMITS.fixpointRounds) {
      s.diagnostics.push(fixpointLimit('the canonical pass', round));
      break;
    }
    s.canonical = { labels, boundaries: entries.filter((e) => !labels.has(e)) };
    const changed = sweep(s, entries, labels);
    if (s.options.mode === 'confirm') break;
    const covered = insideOthers(s, entries);
    const grown = new Set(sortedKeys(labels));
    for (const e of sortedKeys(covered)) grown.add(e);
    if (grown.size === labels.size && changed === 0) break;
    if (grown.size === labels.size) continue;
    labels = grown;
  }
  reclaim(s, entries);
  s.canonical = undefined;
  s.muted = false;
}
