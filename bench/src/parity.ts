// romlift's side of the parity view (architecture §4.5, D11): the ParityView of bench/src/parity-view.ts
// built from an AnalysisResult, field for field as export-poc builds the PoC's, so the two digests are
// comparable. Per function: entry, mode, end (the extent's end), codeEnd, code (the maximal runs of its
// instruction bytes; an absorbed block's instructions are merged into the function's code by the
// driver), pools (its pool words, in the extent or far), tables ([base, count]), far and noreturn (the
// sites of its 'far' and 'noreturn' bl verdicts) and origin. Claims are the maximal runs of kinds 1 to 4
// in ROM order: padding (5) and data (6) are left out, since the PoC claims neither.
import { type AnalysisResult, type FunctionFact, type Span, compareNumbers } from 'romlift';

import {
  type AddrSpan,
  type ClaimKindCode,
  PARITY_SCHEMA,
  type ParityFunction,
  type ParityView,
  parityDigest,
} from './parity-view.ts';

/** Maximal [start, end) runs of `spans`, ascending; touching or overlapping spans merge. */
function runs(spans: readonly Span[]): AddrSpan[] {
  const out: [number, number][] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (s.end <= s.start) continue;
    const last = out[out.length - 1];
    if (last !== undefined && s.start <= last[1]) last[1] = Math.max(last[1], s.end);
    else out.push([s.start, s.end]);
  }
  return out;
}

function sortedUnique(addrs: readonly number[]): number[] {
  return [...addrs].sort(compareNumbers).filter((a, i, all) => i === 0 || all[i - 1] !== a);
}

function parityFunction(f: FunctionFact): ParityFunction {
  const sites = (verdict: 'far' | 'noreturn'): number[] =>
    sortedUnique(f.blVerdicts.filter((v) => v.verdict === verdict).map((v) => v.site));
  return {
    entry: f.entry,
    mode: f.mode,
    end: f.extent.end,
    codeEnd: f.codeEnd,
    code: runs(f.code),
    pools: sortedUnique([...f.pools, ...f.farPools]),
    tables: [...f.tables].sort((a, b) => a.base - b.base).map((t) => [t.base, t.targets.length] as const),
    far: sites('far'),
    noreturn: sites('noreturn'),
    origin: f.origin,
  };
}

function isParityKind(kind: number): kind is ClaimKindCode {
  return kind >= 1 && kind <= 4;
}

/** Maximal runs of one claim kind 1 to 4; the result's runs are split at extents, the view's are not. */
function claimRuns(result: AnalysisResult): Array<readonly [number, number, ClaimKindCode]> {
  const out: [number, number, ClaimKindCode][] = [];
  for (const c of [...result.claims].sort((a, b) => a.span.start - b.span.start)) {
    if (!isParityKind(c.kind) || c.span.end <= c.span.start) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last[1] === c.span.start && last[2] === c.kind) last[1] = c.span.end;
    else out.push([c.span.start, c.span.end, c.kind]);
  }
  return out;
}

/** The parity view of one romlift analysis. */
export function parityViewOf(result: AnalysisResult): ParityView {
  return {
    schema: PARITY_SCHEMA,
    functions: [...result.functions].sort((a, b) => a.entry - b.entry).map(parityFunction),
    claims: claimRuns(result),
    startup: { end: result.startup.span.end, entries: sortedUnique(result.startup.entries) },
    codeEnd: result.codeEnd,
  };
}

/** The parity digest of one romlift analysis: parityDigest of its view. */
export function resultParityDigest(result: AnalysisResult): string {
  return parityDigest(parityViewOf(result));
}
