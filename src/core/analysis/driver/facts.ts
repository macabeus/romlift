// The facts the driver derives from its state: the FunctionFact of an accepted entry (with the run address of an
// entry inside a runs_at range, §6.7), the extent end of a reading (cut at the next listed entry in confirm mode,
// §4.2) and the innermost accepted extent covering an address (§9.3).
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { compareNumbers } from '../../../foundation/util/sorted.ts';
import { innermost, intervalIndex } from '../../../foundation/util/interval-index.ts';
import { runsElsewhere, toRun } from '../address-map.ts';
import { Claim } from '../types.ts';
import type { FunctionFact, InsnSpan, Reading } from '../types.ts';
import { nextSpanStart } from './seeds.ts';
import type { Accepted, DriverState } from './state.ts';

/** The FunctionFact of an accepted entry under the current claims. */
export function factOf(s: DriverState, entry: Addr): FunctionFact | undefined {
  const f = s.funcs.get(entry);
  return f === undefined ? undefined : factFrom(s, f.reading, f);
}

/** The FunctionFact of a block absorbed into the accepted function `into`, as the block reads alone (the queue slot's input). */
export function factOfBlock(s: DriverState, into: Addr, block: Reading): FunctionFact | undefined {
  const f = s.funcs.get(into);
  return f === undefined ? undefined : factFrom(s, block, { origin: f.origin, accepted: f.accepted, also: f.also, absorbed: [] });
}

/** The runs of `dead` claims inside `extent`, in address order (a native scan of the claim bytes, not one claimAt per byte). */
function deadRuns(s: DriverState, extent: Span): Span[] {
  const base = s.rom.base;
  const lo = Math.max(extent.start - base, 0);
  const hi = Math.min(extent.end - base, s.claims.length);
  const dead: Span[] = [];
  if (lo >= hi) return dead;
  const claims = s.claims.subarray(lo, hi);
  for (let k = claims.indexOf(Claim.dead); k >= 0; ) {
    let e = k + 1;
    while (e < claims.length && claims[e] === Claim.dead) e++;
    dead.push({ start: base + lo + k, end: base + lo + e });
    k = e < claims.length ? claims.indexOf(Claim.dead, e) : -1;
  }
  return dead;
}

/** The FunctionFact of reading `r` with the acceptance record `f`, under the current claims. */
function factFrom(s: DriverState, r: Reading, f: Pick<Accepted, 'origin' | 'accepted' | 'also' | 'absorbed'>): FunctionFact {
  const extent = { start: r.entry, end: extentEndOf(s, r) };
  // The instructions' spans merged where they touch, one object per merged run (final-review gates-r1-1: not one per
  // instruction).
  const code: Span[] = [];
  const insns = r.insns;
  const first = insns[0];
  if (first !== undefined) {
    let start = first.addr;
    let end = start + first.len;
    for (let k = 1; k < insns.length; k++) {
      const i = insns[k] as InsnSpan;
      if (end >= i.addr) end = Math.max(end, i.addr + i.len);
      else {
        code.push({ start, end });
        start = i.addr;
        end = i.addr + i.len;
      }
    }
    code.push({ start, end });
  }
  const dead = deadRuns(s, extent);
  const pools = r.pools.map((p) => p.addr).sort(compareNumbers);
  const inside = (a: Addr): boolean => a >= extent.start && a + 4 <= extent.end;
  return {
    entry: r.entry,
    mode: r.mode,
    ...(runsElsewhere(s.addresses, r.entry) ? { runAt: toRun(s.addresses, r.entry) } : {}),
    extent,
    codeEnd: r.codeEnd,
    code,
    dead,
    pools: pools.filter(inside),
    farPools: pools.filter((a) => !inside(a)),
    tables: r.tables,
    calls: r.calls,
    blVerdicts: r.blVerdicts,
    exits: r.exits,
    branchTargets: r.branchTargets,
    adrs: r.adrs,
    veneers: r.veneers,
    absorbed: [...f.absorbed].sort((a, b) => compareNumbers(a.start, b.start)),
    holes: r.holes,
    origin: f.origin,
    accepted: f.accepted,
    also: [...f.also],
  };
}

/**
 * The extent end of a reading; in confirm mode a listed function without a size is cut at the next listed entry that
 * is not a label (§4.2). Either way an extent ends at the first data override after its entry (correctness-b0-3): no
 * function's extent covers one.
 */
export function extentEndOf(s: DriverState, r: Reading): Addr {
  const end = listedExtentEnd(s, r);
  if (s.dataOverrides.length === 0) return end;
  const cut = nextSpanStart(s.dataOverrides, r.entry);
  return cut === undefined ? end : Math.max(r.entry, Math.min(end, cut));
}

/** extentEndOf before the data overrides cut it. */
function listedExtentEnd(s: DriverState, r: Reading): Addr {
  const seed = s.listed.get(r.entry);
  if (seed === undefined) return r.end;
  if (seed.size !== undefined) return r.entry + seed.size;
  const order = s.listedOrder;
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((order[mid] ?? 0) <= r.entry) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < order.length; i++) {
    const a = order[i] ?? 0;
    if (a >= r.end) break;
    if (s.listed.get(a)?.label !== true) return a;
  }
  return r.end;
}

/** The innermost accepted extent covering `a` (rebuilt after each acceptance or absorption). */
export function ownerOf(s: DriverState, a: Addr): Addr | undefined {
  if (s.ownerIndex === undefined) {
    s.ownerIndex = intervalIndex(s.order.map((e) => {
      const r = s.funcs.get(e)?.reading;
      return { start: e, end: r === undefined ? e : extentEndOf(s, r), value: e };
    }));
  }
  return innermost(s.ownerIndex, a)?.value;
}

