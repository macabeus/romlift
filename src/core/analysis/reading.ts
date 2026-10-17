// Building a Reading (architecture §3.3, §9.3): the walker's raw results become an immutable reading
// whose sorted lists, lookups, code end, extent and holes are computed once, here; withVerdicts adds the
// settle loop's bl verdicts to a built reading. romlift/internal
// exports makeReading so the bench can rebuild a reading the proof of concept logged.
import { contains, u16 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { BlSite } from '../profile/types.ts';
import type { BlVerdictRecord, CallSite, Exit, InsnLookup, InsnSpan, JumpTable, PoolWord, Reading, ReadingError, WalkDecision } from './types.ts';

/** Everything a reading is built from; `end` comes from the extent rule (claim.adjacent-pools). */
export interface ReadingParts {
  readonly entry: Addr;
  readonly mode: Mode;
  /** Any order; one per address. */
  readonly insns: readonly InsnSpan[];
  /** Walk order; a repeated address keeps its first position and its first value. */
  readonly pools: readonly PoolWord[];
  /** Walk order; a repeated base keeps its first position and its last targets (the PoC's Map.set). */
  readonly tables: readonly JumpTable[];
  /** Any order; duplicates dropped. */
  readonly calls: readonly CallSite[];
  readonly blSites: readonly BlSite[];
  readonly deadEnd: readonly Addr[];
  readonly balance: readonly number[];
  readonly returns: number;
  readonly errors: readonly ReadingError[];
  readonly veneers: readonly Addr[];
  readonly adrs: readonly Addr[];
  readonly tails: readonly Addr[];
  readonly tailExits: number;
  readonly far?: readonly Addr[];
  readonly noret?: readonly Addr[];
  readonly blVerdicts?: readonly BlVerdictRecord[];
  readonly exits?: readonly Exit[];
  readonly branchTargets?: readonly Addr[];
  readonly armTails?: readonly Span[];
  /** Walk order. */
  readonly steps?: readonly WalkDecision[];
  readonly end: Addr;
}

/** The PoC's `calls` order: target, then mode ('arm' before 'thumb'), then site. */
export function compareCalls(a: CallSite, b: CallSite): number {
  if (a.target !== b.target) return a.target - b.target;
  if (a.mode !== b.mode) return a.mode === 'arm' ? -1 : 1;
  return a.site - b.site;
}

/** One past the last instruction byte; the entry when there is none. */
export function codeEndOf(entry: Addr, insns: readonly InsnSpan[]): Addr {
  let end = entry;
  for (const i of insns) end = Math.max(end, i.addr + i.len);
  return end;
}

function sortedUnique(list: readonly Addr[]): readonly Addr[] {
  if (list.length < 2) return list;
  const out = [...list].sort(compareNumbers);
  return out.filter((a, i) => i === 0 || out[i - 1] !== a);
}

function uniqueInsns(insns: readonly InsnSpan[], prepared?: InsnLookup): { list: readonly InsnSpan[]; at: InsnLookup } {
  if (prepared !== undefined && prepared.size === insns.length) return { list: insns, at: prepared };
  const at = new Map<Addr, number>();
  let sorted = true;
  for (let k = 0; k < insns.length; k++) {
    const i = insns[k] as InsnSpan;
    if (k > 0 && (insns[k - 1] as InsnSpan).addr >= i.addr) sorted = false;
    if (!at.has(i.addr)) at.set(i.addr, i.len);
  }
  if (sorted) return { list: insns, at };
  const list = [...insns].sort((a, b) => a.addr - b.addr).filter((i, k, all) => k === 0 || all[k - 1]?.addr !== i.addr);
  return { list, at };
}

function uniquePools(pools: readonly PoolWord[]): { list: readonly PoolWord[]; at: Map<Addr, number> } {
  const at = new Map<Addr, number>();
  const list: PoolWord[] = [];
  for (const p of pools) {
    if (at.has(p.addr)) continue;
    at.set(p.addr, p.value);
    list.push(p);
  }
  return { list, at };
}

function uniqueTables(tables: readonly JumpTable[]): readonly JumpTable[] {
  const list: JumpTable[] = [];
  for (const t of tables) {
    const i = list.findIndex((x) => x.base === t.base);
    if (i < 0) list.push(t);
    else list[i] = t;
  }
  return list;
}

function uniqueCalls(calls: readonly CallSite[]): readonly CallSite[] {
  const out = [...calls].sort(compareCalls);
  return out.filter((c, i) => i === 0 || compareCalls(out[i - 1] as CallSite, c) !== 0);
}

function sortedVerdicts(verdicts: readonly BlVerdictRecord[]): readonly BlVerdictRecord[] {
  if (verdicts.length < 2) return verdicts;
  return [...verdicts].sort((a, b) => a.site - b.site);
}

/** The covered byte ranges of [entry, end), merged and sorted: instructions, pools and tables inside it. */
function covered(entry: Addr, end: Addr, insns: readonly InsnSpan[], pools: readonly PoolWord[], tables: readonly JumpTable[]): Span[] {
  const extra: Span[] = [];
  for (const p of pools) if (p.addr >= entry && p.addr + 4 <= end) extra.push({ start: p.addr, end: p.addr + 4 });
  for (const t of tables) {
    const n = 4 * t.targets.length;
    if (t.base >= entry && t.base + n <= end && n > 0) extra.push({ start: t.base, end: t.base + n });
  }
  extra.sort((a, b) => a.start - b.start);
  // `insns` is sorted by address: merge it with the sorted extras in one pass.
  const merged: Span[] = [];
  let start = 0;
  let stop = -1;
  const add = (a: Addr, b: Addr): void => {
    if (stop >= 0 && a <= stop) {
      if (b > stop) stop = b;
      return;
    }
    if (stop >= 0) merged.push({ start, end: stop });
    start = a;
    stop = b;
  };
  let j = 0;
  for (const i of insns) {
    if (i.len <= 0 || i.addr < entry || i.addr + i.len > end) continue;
    for (let x = extra[j]; x !== undefined && x.start < i.addr; x = extra[++j]) add(x.start, x.end);
    add(i.addr, i.addr + i.len);
  }
  for (let x = extra[j]; x !== undefined; x = extra[++j]) add(x.start, x.end);
  if (stop >= 0) merged.push({ start, end: stop });
  return merged;
}

/**
 * The PoC's dense() count: over [entry, end) in halfword steps from the entry, a halfword whose first byte
 * no instruction, pool or table covers is a hole unless it is zero and the byte two further is covered or
 * past the end. Only the uncovered stretches are visited.
 */
function holesOf(rom: Rom, entry: Addr, end: Addr, insns: readonly InsnSpan[], pools: readonly PoolWord[], tables: readonly JumpTable[]): {
  holes: readonly Span[];
  bytes: number;
} {
  if (end <= entry) return { holes: [], bytes: 0 };
  const cov = covered(entry, end, insns, pools, tables);
  // Queries never decrease, so the scan of `cov` only moves forward.
  let c = 0;
  const isCovered = (a: Addr): boolean => {
    while (c < cov.length && (cov[c] as Span).end <= a) c++;
    const s = cov[c];
    return s !== undefined && s.start <= a;
  };
  const holes: Span[] = [];
  let bytes = 0;
  let next = 0;
  for (let gap = 0; gap <= cov.length; gap++) {
    const from = gap === 0 ? entry : (cov[gap - 1] as Span).end;
    const to = gap < cov.length ? (cov[gap] as Span).start : end;
    let a = Math.max(from, next);
    if ((a - entry) & 1) a += 1;
    for (; a < to; a += 2) {
      if (isCovered(a)) continue;
      const zero = contains(rom, a, 2) && u16(rom, a) === 0;
      if (zero && (a + 2 >= end || isCovered(a + 2))) continue;
      bytes += 2;
      const stop = Math.min(a + 2, end);
      const last = holes[holes.length - 1];
      if (last !== undefined && last.end === a) holes[holes.length - 1] = { start: last.start, end: stop };
      else holes.push({ start: a, end: stop });
    }
    next = a;
  }
  return { holes, bytes };
}

/**
 * Builds the immutable reading of `parts`. `insnAt` may hand over a lookup the caller already holds for
 * exactly `parts.insns`, sorted and unique (the walker's record); it is then not rebuilt.
 */
export function makeReading(parts: ReadingParts, rom: Rom, insnAt?: InsnLookup): Reading {
  const insns = uniqueInsns(parts.insns, insnAt);
  const pools = uniquePools(parts.pools);
  const tables = uniqueTables(parts.tables);
  const codeEnd = codeEndOf(parts.entry, insns.list);
  const end = Math.max(parts.end, codeEnd);
  const holes = holesOf(rom, parts.entry, end, insns.list, pools.list, tables);
  return {
    entry: parts.entry,
    mode: parts.mode,
    insns: insns.list,
    insnAt: insns.at,
    pools: pools.list,
    poolAt: pools.at,
    tables,
    calls: uniqueCalls(parts.calls),
    blSites: parts.blSites,
    deadEnd: sortedUnique(parts.deadEnd),
    balance: parts.balance,
    returns: parts.returns,
    errors: parts.errors,
    veneers: sortedUnique(parts.veneers),
    adrs: sortedUnique(parts.adrs),
    tails: sortedUnique(parts.tails),
    tailExits: parts.tailExits,
    far: sortedUnique(parts.far ?? []),
    noret: sortedUnique(parts.noret ?? []),
    blVerdicts: sortedVerdicts(parts.blVerdicts ?? []),
    exits: [...(parts.exits ?? [])].sort((a, b) => a.at - b.at || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    branchTargets: sortedUnique(parts.branchTargets ?? []),
    armTails: [...(parts.armTails ?? [])].sort((a, b) => a.start - b.start || a.end - b.end),
    steps: parts.steps ?? [],
    codeEnd,
    end,
    holes: holes.holes,
    holeBytes: holes.bytes,
  };
}

/** What the settle loop decided about a reading's bl sites, and the walk-slot answers of all its rounds. */
export interface SettleVerdicts {
  readonly far: readonly Addr[];
  readonly noret: readonly Addr[];
  readonly blVerdicts: readonly BlVerdictRecord[];
  readonly steps: readonly WalkDecision[];
}

/**
 * The reading `r` of the last settle round with the loop's verdicts: its calls without the far sites, the
 * far and never-returning sites and the verdict records sorted as makeReading sorts them, and the steps
 * of every round (or the walk's own when none). The verdicts change no instruction, pool or table, so the
 * extent and holes are kept as computed.
 */
export function withVerdicts(r: Reading, v: SettleVerdicts): Reading {
  const far = sortedUnique(v.far);
  const farSites = new Set(far);
  return {
    ...r,
    calls: farSites.size === 0 ? r.calls : r.calls.filter((c) => !farSites.has(c.site)),
    far,
    noret: sortedUnique(v.noret),
    blVerdicts: sortedVerdicts(v.blVerdicts),
    steps: v.steps.length === 0 ? r.steps : v.steps,
  };
}

/** The parts a reading was built from, for rebuilding it with some fields changed. */
export function partsOf(r: Reading): ReadingParts {
  return {
    entry: r.entry,
    mode: r.mode,
    insns: r.insns,
    pools: r.pools,
    tables: r.tables,
    calls: r.calls,
    blSites: r.blSites,
    deadEnd: r.deadEnd,
    balance: r.balance,
    returns: r.returns,
    errors: r.errors,
    veneers: r.veneers,
    adrs: r.adrs,
    tails: r.tails,
    tailExits: r.tailExits,
    far: r.far,
    noret: r.noret,
    blVerdicts: r.blVerdicts,
    exits: r.exits,
    branchTargets: r.branchTargets,
    armTails: r.armTails,
    steps: r.steps,
    end: r.end,
  };
}
