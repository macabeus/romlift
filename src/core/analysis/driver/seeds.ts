// The seeds a run starts from (architecture §4.2, D12, D59 r): they come from the project's TOML or from
// evidence, never from the ROM, so the driver checks their shape before round 0. A seed whose entry is not
// a safe integer, whose mode is neither 'thumb' nor 'arm', or whose size is not a positive integer that
// fits the ROM from its entry is left out with W_SEED_MALFORMED; it would otherwise make a walk or an
// extent of nothing (an entry of NaN, a negative or a 64 MiB size). An entry outside the ROM, odd, or
// listed twice is well formed: validity judges it (W_LISTED_INVALID).
//
// The overrides without runs_at apply here too (correctness-b0-3; a runs_at range is the address map's, §6.7): each
// `code` override builds a seed.override seed at its start in its mode (Thumb when it names none), and each `data`
// override's span, clipped to the ROM, is claimed as data before round 0 (driver/state.ts), a claim no walk enters
// and no later claim overwrites. An override whose start is no instruction address of its mode, or whose span is no
// range inside the ROM, builds nothing (core/model then warns W_OVERRIDE_IGNORED).
import { diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { contains } from '../../../foundation/rom/rom.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { insnAligned } from '../../../foundation/rom/span.ts';
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { AnalysisCodes } from '../codes.ts';
import type { AnalysisCode } from '../codes.ts';
import type { OverrideFact, Seed } from '../types.ts';

/** Why a seed is malformed, or undefined when it is well formed. */
export function seedProblem(rom: Rom, seed: Seed): string | undefined {
  if (!Number.isSafeInteger(seed.entry) || seed.entry < 0) return `its entry ${String(seed.entry)} is not an address`;
  if (seed.mode !== 'thumb' && seed.mode !== 'arm') return `its mode ${String(seed.mode)} is neither thumb nor arm`;
  if (seed.size === undefined) return undefined;
  if (!Number.isSafeInteger(seed.size) || seed.size <= 0) return `its size ${String(seed.size)} is not a positive integer`;
  const fits = contains(rom, seed.entry) ? contains(rom, seed.entry, seed.size) : seed.size <= rom.bytes.length;
  return fits ? undefined : `its size ${seed.size} runs past the end of the ROM`;
}

/** The well-formed seeds, in their order, and a W_SEED_MALFORMED for each one left out. */
export function wellFormedSeeds(rom: Rom, seeds: readonly Seed[]): { readonly seeds: readonly Seed[]; readonly diagnostics: readonly Diagnostic<AnalysisCode>[] } {
  const kept: Seed[] = [];
  const diagnostics: Diagnostic<AnalysisCode>[] = [];
  for (const seed of seeds) {
    const problem = seedProblem(rom, seed);
    if (problem === undefined) {
      kept.push(seed);
      continue;
    }
    const at = Number.isSafeInteger(seed.entry) && seed.entry >= 0 ? hexAddr(seed.entry) : String(seed.entry);
    diagnostics.push(
      diagnostic(AnalysisCodes, 'W_SEED_MALFORMED', `the ${seed.rule} seed at ${at} is left out: ${problem}`, {
        ...(Number.isSafeInteger(seed.entry) && seed.entry >= 0 ? { addr: seed.entry } : {}),
        rule: seed.rule,
      }),
    );
  }
  return { seeds: kept, diagnostics };
}

/** Whether the analysis applies `o` itself: no runs_at, and a span of safe integers that is not empty. */
function appliedHere(o: OverrideFact): boolean {
  return o.runsAt === undefined && Number.isSafeInteger(o.span.start) && Number.isSafeInteger(o.span.end) && o.span.start < o.span.end;
}

/** The seed.override seeds of the code overrides without runs_at: one at each start inside the ROM that is an instruction address of its mode. */
export function overrideSeeds(rom: Rom, overrides: readonly OverrideFact[]): readonly Seed[] {
  return overrides.flatMap((o): Seed[] => {
    const mode = o.mode ?? 'thumb';
    if (o.kind !== 'code' || !appliedHere(o) || !contains(rom, o.span.start) || !insnAligned(mode, o.span.start)) return [];
    return [{ entry: o.span.start, mode, rule: 'seed.override' }];
  });
}

/** The spans of the data overrides without runs_at, clipped to the ROM, sorted and merged where they touch. */
export function dataOverrideSpans(rom: Rom, overrides: readonly OverrideFact[]): readonly Span[] {
  const clipped = overrides
    .filter((o) => o.kind === 'data' && appliedHere(o))
    .map((o) => ({ start: Math.max(o.span.start, rom.base), end: Math.min(o.span.end, rom.end) }))
    .filter((s) => s.start < s.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const s of clipped) {
    const last = merged[merged.length - 1];
    if (last !== undefined && s.start <= last.end) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
    else merged.push(s);
  }
  return merged;
}

/** The index of the span of `spans` (sorted, disjoint) holding `a`, or -1. */
function spanIndex(spans: readonly Span[], a: Addr): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((spans[mid]?.end ?? 0) <= a) lo = mid + 1;
    else hi = mid;
  }
  const s = spans[lo];
  return s !== undefined && s.start <= a ? lo : -1;
}

/** Whether `a` lies in one of `spans` (dataOverrideSpans). */
export function inSpans(spans: readonly Span[], a: Addr): boolean {
  return spans.length !== 0 && spanIndex(spans, a) >= 0;
}

/** The start of the first of `spans` above `a`, or undefined. */
export function nextSpanStart(spans: readonly Span[], a: Addr): Addr | undefined {
  for (const s of spans) if (s.start > a) return s.start;
  return undefined;
}

/** The parts of [lo, hi) outside `spans`, in order. */
export function outsideSpans(spans: readonly Span[], lo: Addr, hi: Addr): readonly Span[] {
  const out: Span[] = [];
  let at = lo;
  for (const s of spans) {
    if (s.end <= at) continue;
    if (s.start >= hi) break;
    if (s.start > at) out.push({ start: at, end: s.start });
    at = Math.max(at, s.end);
  }
  if (at < hi) out.push({ start: at, end: hi });
  return out;
}
