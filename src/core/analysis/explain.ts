// The analysis part of `explain` (architecture §9.2, D35): what the analysis decided about one address.
// The caller re-runs the analysis with trail 'full' and `trailFilter` set to explainFilter(addr, …): the
// 256-byte bucket around the address, widened to the extents that cover it. explainAnalysis then reads
// the claim at the address, the innermost function whose extent covers it with every provenance record
// of that function, the filtered trail events, and the metadata of every rule those name. Pure: the
// result, the events and the rule metadata in, plain data out.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import type { Provenance } from '../provenance/provenance.ts';
import type { RuleId, RuleMeta } from '../provenance/rule-id.ts';
import type { TrailEvent } from '../provenance/trail.ts';
import type { Origin } from '../provenance/vocabulary.ts';
import { Claim } from './types.ts';
import type { AnalysisResult, ClaimKind, FunctionFact } from './types.ts';

/** The size of the address bucket an explanation's trail is filtered to. */
export const EXPLAIN_BUCKET = 0x100;

export interface AnalysisExplanation {
  readonly addr: Addr;
  /** The claim of the byte at `addr` (free when nothing claimed it). */
  readonly claim: ClaimKind;
  /** The innermost function whose extent covers `addr`: its entry, origin and every provenance record. */
  readonly owner?: { readonly entry: Addr; readonly origin: Origin; readonly provenance: readonly Provenance[] };
  /** Proposals, rejections with their miss reason, verdicts (bl, walk steps, gap prefer and skip), waits, claims: in trail order. */
  readonly events: readonly TrailEvent[];
  /** The metadata of every rule id named above, sorted by id; ids without metadata are left out. */
  readonly rules: readonly RuleMeta[];
}

/** The `EXPLAIN_BUCKET`-aligned bucket that holds `addr`. */
export function explainBucket(addr: Addr): Span {
  const start = addr - (addr % EXPLAIN_BUCKET);
  return { start, end: start + EXPLAIN_BUCKET };
}

/** The functions of `functions` whose extent covers `addr`. */
function covering(functions: readonly FunctionFact[], addr: Addr): readonly FunctionFact[] {
  return functions.filter((f) => f.extent.start <= addr && addr < f.extent.end);
}

/**
 * The trail filter of an explanation: the bucket around `addr`, widened to every extent of `result`
 * (an earlier run of the same analysis) that covers `addr`, so the events of the owning function's
 * decisions are kept. Without a result it is the bucket alone.
 */
export function explainFilter(addr: Addr, result?: Pick<AnalysisResult, 'functions'>): Span {
  let { start, end } = explainBucket(addr);
  for (const f of covering(result?.functions ?? [], addr)) {
    start = Math.min(start, f.extent.start);
    end = Math.max(end, f.extent.end);
  }
  return { start, end };
}

/** The claim kind of the run covering `addr` in the sorted, disjoint claim runs. */
function claimAt(claims: AnalysisResult['claims'], addr: Addr): ClaimKind {
  let lo = 0;
  let hi = claims.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = claims[mid];
    if (run === undefined) break;
    if (addr < run.span.start) hi = mid - 1;
    else if (addr >= run.span.end) lo = mid + 1;
    else return run.kind;
  }
  return Claim.free;
}

/** The innermost covering function: the latest start, then the earliest end, then the lowest entry. */
function ownerOf(functions: readonly FunctionFact[], addr: Addr): FunctionFact | undefined {
  let best: FunctionFact | undefined;
  for (const f of covering(functions, addr)) {
    if (
      best === undefined ||
      f.extent.start > best.extent.start ||
      (f.extent.start === best.extent.start && (f.extent.end < best.extent.end || (f.extent.end === best.extent.end && f.entry < best.entry)))
    ) {
      best = f;
    }
  }
  return best;
}

/** The explanation of `addr` from a finished `result`, its filtered trail `events` and the metadata of the registered rules. */
export function explainAnalysis(result: AnalysisResult, events: readonly TrailEvent[], addr: Addr, rules: readonly RuleMeta[]): AnalysisExplanation {
  const owner = ownerOf(result.functions, addr);
  const provenance = owner === undefined ? [] : [owner.accepted, ...owner.also];
  const named = new Set<RuleId>();
  for (const p of provenance) named.add(p.rule);
  for (const e of events) named.add(e.rule);
  const metas = rules.filter((m) => named.has(m.id)).sort((a, b) => compareCodeUnits(a.id, b.id));
  const unique = metas.filter((m, i) => i === 0 || metas[i - 1]?.id !== m.id);
  return {
    addr,
    claim: claimAt(result.claims, addr),
    ...(owner === undefined ? {} : { owner: { entry: owner.entry, origin: owner.origin, provenance } }),
    events: [...events],
    rules: unique,
  };
}
