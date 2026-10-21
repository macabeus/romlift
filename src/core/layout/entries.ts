// The listed entries of an analysis and where each one's extent ends (architecture §6.2, D62): the entries a
// model's chunks start at (discover mode: every function, nested ones as labels; confirm mode: the TOML's
// functions with their size and label), and the end of each extent (the TOML's size, the analysis' extent, a code
// override, or the next chunk start). Part of the legal-border computation of borders.ts, which re-exports what
// core/model uses.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult, FunctionFact } from '../analysis/types.ts';

/**
 * Where a chunk's end comes from: the analysis' extent, the TOML's size, a code override, or up to the next
 * listed entry. ModelFunction.source.extent (core/model/types.ts) is this type.
 */
export type ExtentSource = 'analysis' | 'toml-size' | 'override' | 'next-listed';

/** A listed entry: a config function, or a function of the analysis. */
export interface ListedEntry {
  readonly entry: Addr;
  /** A label entry starts no chunk (FunctionConfig.label, or nested in discover mode). */
  readonly label: boolean;
  readonly size?: number;
}

/** A listed entry with the end of its extent; `end` undefined: up to the next chunk start. */
export interface PlacedEntry {
  readonly entry: Addr;
  readonly label: boolean;
  readonly end: Addr | undefined;
  readonly source: ExtentSource;
  /**
   * The code override that gave the extent (source 'override'): placeEntries is where an override without runs_at is
   * applied, so this is the report core/model's W_OVERRIDE_IGNORED reads (fix round 6, architecture-b1-2).
   */
  readonly override?: Span;
}

/** The end of a function's extent with the header clipped off: the cartridge entry's extent covers the header (correctness-6). */
function clippedExtentEnd(f: Pick<FunctionFact, 'entry' | 'extent'>, headerEnd: Addr): Addr {
  return f.entry < headerEnd ? Math.min(f.extent.end, headerEnd) : f.extent.end;
}

/** The functions of the analysis by entry. */
export function factsByEntry(analysis: Pick<AnalysisResult, 'functions'>): ReadonlyMap<Addr, FunctionFact> {
  return new Map(analysis.functions.map((f) => [f.entry, f] as const));
}

/**
 * Where each listed entry's extent ends: the size the config gives, else the analysis' extent, else a code
 * override containing it (the override recorded on the entry: the one use of an override without runs_at), else the
 * next chunk start ('next-listed'). `listed` is sorted by entry.
 */
export function placeEntries(listed: readonly ListedEntry[], analysis: Pick<AnalysisResult, 'functions' | 'options'>): PlacedEntry[] {
  const facts = factsByEntry(analysis);
  const codeOverrides = analysis.options.overrides.filter((o) => o.kind === 'code');
  return listed.map((l): PlacedEntry => {
    if (l.size !== undefined) return { entry: l.entry, label: l.label, end: l.entry + l.size, source: 'toml-size' };
    const fact = facts.get(l.entry);
    if (fact !== undefined) return { entry: l.entry, label: l.label, end: fact.extent.end, source: 'analysis' };
    const override = codeOverrides.find((o) => l.entry >= o.span.start && l.entry < o.span.end);
    if (override !== undefined) return { entry: l.entry, label: l.label, end: override.span.end, source: 'override', override: override.span };
    return { entry: l.entry, label: l.label, end: undefined, source: 'next-listed' };
  });
}

/** The entries of `functions` (sorted by entry) strictly inside an earlier function's extent, each extent ending at `endOf`. */
function insideEarlier(functions: readonly FunctionFact[], endOf: (f: FunctionFact) => Addr): ReadonlySet<Addr> {
  const nested = new Set<Addr>();
  let reach = -Infinity;
  for (const f of functions) {
    if (f.entry < reach) nested.add(f.entry);
    reach = Math.max(reach, endOf(f));
  }
  return nested;
}

/**
 * The entries of `functions` (sorted by entry) that lie strictly inside an earlier function's extent, the
 * header clipped off the cartridge entry's: the label entries of a discover model.
 */
export function nestedEntries(functions: readonly FunctionFact[], headerEnd: Addr): ReadonlySet<Addr> {
  return insideEarlier(functions, (f) => clippedExtentEnd(f, headerEnd));
}

/**
 * The entries of `functions` (sorted by entry) strictly inside an earlier function's extent as the analysis
 * gives it, nothing clipped: configFromDiscover lists them with `label = true`, so the confirm run reads every
 * extent as the discover run did (the listed set of g2.confirm-equals-discover). The cartridge entry's extent
 * covers the startup code it branches to; were that entry not a label, the confirm run would cut the cartridge
 * entry at it and accept it as a call, outside the startup region.
 */
export function coveredEntries(functions: readonly FunctionFact[]): ReadonlySet<Addr> {
  return insideEarlier(functions, (f) => f.extent.end);
}

/**
 * The entries past the header that only the cartridge entry's extent covers (coveredEntries but not
 * nestedEntries): the header chunk clips that extent (correctness-6), so a `label = true` entry there still
 * starts a chunk.
 */
export function headerCoveredEntries(functions: readonly FunctionFact[], headerEnd: Addr): ReadonlySet<Addr> {
  const nested = nestedEntries(functions, headerEnd);
  const covered = coveredEntries(functions);
  return new Set(functions.map((f) => f.entry).filter((e) => e >= headerEnd && covered.has(e) && !nested.has(e)));
}

/** Whether a listed entry starts no chunk: its config says `label = true` and an extent past the header covers it. */
export function isLabelEntry(entry: Addr, label: boolean | undefined, headerCovered: ReadonlySet<Addr>): boolean {
  return label === true && !headerCovered.has(entry);
}

/**
 * The listed entries of an analysis: in discover mode every function, nested ones as labels; in confirm mode
 * the listed seeds (the TOML's functions), with their `size` and their `label` (isLabelEntry).
 */
export function listedEntriesOf(analysis: AnalysisResult, headerEnd: Addr): ListedEntry[] {
  if (analysis.mode === 'discover') {
    const nested = nestedEntries(analysis.functions, headerEnd);
    return analysis.functions.map((f) => ({ entry: f.entry, label: nested.has(f.entry) }));
  }
  const seeds = analysis.options.seeds.filter((s) => s.rule === 'seed.listed').sort((a, b) => compareNumbers(a.entry, b.entry));
  const headerCovered = headerCoveredEntries(analysis.functions, headerEnd);
  return seeds
    .filter((s, i) => i === 0 || seeds[i - 1]?.entry !== s.entry)
    .map((s) => ({ entry: s.entry, label: isLabelEntry(s.entry, s.label, headerCovered), ...(s.size === undefined ? {} : { size: s.size }) }));
}

