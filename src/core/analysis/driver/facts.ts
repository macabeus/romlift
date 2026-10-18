// The facts the driver derives from its state: the FunctionFact of an accepted entry, the extent end of a
// reading (cut at the next listed entry in confirm mode, §4.2) and the innermost accepted extent covering
// an address (§9.3).
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { compareNumbers } from '../../../foundation/util/sorted.ts';
import { innermost, intervalIndex } from '../../../foundation/util/interval-index.ts';
import { Claim } from '../types.ts';
import type { FunctionFact, Reading } from '../types.ts';
import { claimAt } from './state.ts';
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

/** The FunctionFact of reading `r` with the acceptance record `f`, under the current claims. */
function factFrom(s: DriverState, r: Reading, f: Pick<Accepted, 'origin' | 'accepted' | 'also' | 'absorbed'>): FunctionFact {
  const extent = { start: r.entry, end: extentEndOf(s, r) };
  const code: Span[] = [];
  for (const i of r.insns) {
    const last = code[code.length - 1];
    if (last !== undefined && last.end >= i.addr) code[code.length - 1] = { start: last.start, end: Math.max(last.end, i.addr + i.len) };
    else code.push({ start: i.addr, end: i.addr + i.len });
  }
  const dead: Span[] = [];
  for (let a = extent.start; a < extent.end; a++) {
    if (claimAt(s, a) !== Claim.dead) continue;
    const last = dead[dead.length - 1];
    if (last !== undefined && last.end === a) dead[dead.length - 1] = { start: last.start, end: a + 1 };
    else dead.push({ start: a, end: a + 1 });
  }
  const pools = r.pools.map((p) => p.addr).sort(compareNumbers);
  const inside = (a: Addr): boolean => a >= extent.start && a + 4 <= extent.end;
  return {
    entry: r.entry,
    mode: r.mode,
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

/** The extent end of a reading; in confirm mode a listed function without a size is cut at the next listed entry that is not a label (§4.2). */
export function extentEndOf(s: DriverState, r: Reading): Addr {
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

