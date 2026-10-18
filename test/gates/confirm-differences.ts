// The comparison of g2.confirm-equals-discover (architecture §4.2, D8, D61 e), in one place: the gate calls
// it and test/unit/gates/confirm-differences.test.ts tests it. Two parity views (functions with their
// extents and far `bl` verdicts, and claim runs) are compared in full: every function that differs (in one
// view only, or with another mode, extent or far verdicts) and every claim run that differs, each with its
// record in both views.
//
// The owner's answer to Q3 of phase-2.md (18 October 2026, "Build resettle, else accept"): D8's resettle
// stage was built and measured (f287b0d) and reverted (af0f75c) because it changes rows on the other tuning
// ROMs and the sealed pair, so tmc's six differences are a known phase-2 limitation (KNOWN_DIFFERENCES).
// They are pinned by content: each function's discover and confirm records and each differing claim run's,
// as measured at 9c8b282 (identical at 95b257b^ and 5e18731). The gate accepts a ROM's differences only
// when they are exactly those records, no more and no fewer: a known function that differs otherwise
// (another extent, mode or far verdicts, or gone from a view) is a changed limitation, one that no longer
// differs, or a record whose ROM is not a tuning dataset, is a stale record, and each fails; so does the
// record when the dataset's ROM or ELF is not the one it was decided on (dataset-binding.ts). It prints
// the limitation every run. Every other ROM must have no difference at all.

import { bindingMismatch, byCodeUnit, TMC_AT_D61, type DatasetBinding } from './dataset-binding.ts';

export interface ViewFunction {
  readonly entry: number;
  readonly mode: string;
  readonly extent: { readonly start: number; readonly end: number };
  readonly far: readonly { readonly site: number; readonly target: number }[];
}

export interface ViewClaim {
  readonly span: { readonly start: number; readonly end: number };
  readonly kind: number;
  readonly owner?: number | undefined;
}

export interface ParityView {
  readonly functions: readonly ViewFunction[];
  readonly claims: readonly ViewClaim[];
}

/** One function that differs: its record in each view, null where the view has none. */
export interface FunctionDifference {
  readonly entry: number;
  readonly discover: ViewFunction | null;
  readonly confirm: ViewFunction | null;
}

/** One claim run (by span) that differs: its record in each view, null where the view has none. */
export interface ClaimDifference {
  readonly span: { readonly start: number; readonly end: number };
  readonly discover: ViewClaim | null;
  readonly confirm: ViewClaim | null;
}

export interface ViewDifferences {
  /** Ascending by entry. */
  readonly functions: readonly FunctionDifference[];
  /** Ascending by start, then end. */
  readonly claims: readonly ClaimDifference[];
}

/** A ROM whose confirm and discover views differ by a recorded limitation, pinned by content. */
export interface KnownDifferences {
  readonly decision: string;
  readonly reason: string;
  /** The dataset the limitation was measured and decided on. */
  readonly rom: DatasetBinding;
  readonly functions: readonly FunctionDifference[];
  readonly claims: readonly ClaimDifference[];
  /**
   * Differences known not to be covered, by entry, each with why: printed with its failure instead of the
   * neutral "not covered" text. They still fail.
   */
  readonly notCovered?: Readonly<Record<number, string>>;
}

const thumb = (entry: number, end: number): ViewFunction => ({ entry, mode: 'thumb', extent: { start: entry, end }, far: [] });
const arm = (entry: number, end: number): ViewFunction => ({ entry, mode: 'arm', extent: { start: entry, end }, far: [] });

/**
 * tmc's six differences (D61 e), the six Q3 named, with their records as measured at 9c8b282: functions of
 * hand-written code with several entries, whose shared code goes to whichever entry is taken first (D60 k),
 * so confirm, which takes every listed entry from round 0, cuts them where discover does not; and the one
 * claim run that follows (0x080087D2..0x08008886, owned by 0x08008790 in discover, unowned in confirm).
 * Nothing else is covered.
 */
export const KNOWN_DIFFERENCES: Readonly<Record<string, KnownDifferences>> = {
  tmc: {
    decision: 'D61 e',
    reason:
      'known phase-2 limitation (the owner\'s answer to Q3 on 2026-10-18, "Build resettle, else accept": the resettle stage changed rows on the other tuning ROMs and the sealed pair and was reverted)',
    rom: TMC_AT_D61,
    functions: [
      { entry: 0x0800_4274, discover: thumb(0x0800_4274, 0x0800_4356), confirm: thumb(0x0800_4274, 0x0800_42ac) },
      { entry: 0x0800_42b8, discover: thumb(0x0800_42b8, 0x0800_42d0), confirm: thumb(0x0800_42b8, 0x0800_432a) },
      { entry: 0x0800_42ba, discover: thumb(0x0800_42ba, 0x0800_42d0), confirm: thumb(0x0800_42ba, 0x0800_432a) },
      { entry: 0x0800_43ac, discover: thumb(0x0800_43ac, 0x0800_43e8), confirm: thumb(0x0800_43ac, 0x0800_43b0) },
      { entry: 0x0800_8790, discover: thumb(0x0800_8790, 0x0800_8886), confirm: thumb(0x0800_8790, 0x0800_8796) },
      { entry: 0x080b_1a8c, discover: arm(0x080b_1a8c, 0x080b_1af0), confirm: arm(0x080b_1a8c, 0x080b_1aa8) },
    ],
    claims: [
      {
        span: { start: 0x0800_87d2, end: 0x0800_8886 },
        discover: { span: { start: 0x0800_87d2, end: 0x0800_8886 }, kind: 1, owner: 0x0800_8790 },
        confirm: { span: { start: 0x0800_87d2, end: 0x0800_8886 }, kind: 1 },
      },
    ],
    notCovered: {
      0x080b_255c: "moved by the pool boundary of 95b257b, after Q3's count at 9c8b282: owner question Q6 of phase-2.md",
      0x080b_2874: "moved by the pool boundary of 95b257b, after Q3's count at 9c8b282: owner question Q6 of phase-2.md",
    },
  },
};

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function span(s: { readonly start: number; readonly end: number }): string {
  return `${hex(s.start)}..${hex(s.end)}`;
}

/** A function record in words; equal words, equal records. */
function fnText(f: ViewFunction | null): string {
  if (f === null) return 'none';
  return `${hex(f.entry)} ${f.mode} ${span(f.extent)}${f.far.length === 0 ? '' : ` far ${f.far.map((v) => `${hex(v.site)}->${hex(v.target)}`).join(',')}`}`;
}

/** A claim record in words; equal words, equal records. */
function claimText(c: ViewClaim | null): string {
  if (c === null) return 'none';
  return `${span(c.span)} kind ${c.kind} owner ${c.owner === undefined ? 'none' : hex(c.owner)}`;
}

function fnDiffText(d: FunctionDifference): string {
  return `function ${hex(d.entry)}: discover ${fnText(d.discover)}, confirm ${fnText(d.confirm)}`;
}

function claimDiffText(d: ClaimDifference): string {
  return `claim ${span(d.span)}: discover ${claimText(d.discover)}, confirm ${claimText(d.confirm)}`;
}

const spanKey = (s: { readonly start: number; readonly end: number }): string => `${s.start}:${s.end}`;

/** Every difference between the discover and the confirm view. */
export function viewDifferences(discover: ParityView, confirm: ParityView): ViewDifferences {
  const a = new Map(discover.functions.map((f) => [f.entry, f]));
  const b = new Map(confirm.functions.map((f) => [f.entry, f]));
  const functions: FunctionDifference[] = [];
  for (const entry of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(entry) ?? null;
    const y = b.get(entry) ?? null;
    if (fnText(x) === fnText(y)) continue;
    functions.push({ entry, discover: x, confirm: y });
  }
  const inA = new Map(discover.claims.map((c) => [spanKey(c.span), c]));
  const inB = new Map(confirm.claims.map((c) => [spanKey(c.span), c]));
  const claims: ClaimDifference[] = [];
  const seen = new Set<string>();
  for (const c of [...discover.claims, ...confirm.claims]) {
    const k = spanKey(c.span);
    if (seen.has(k)) continue;
    seen.add(k);
    const x = inA.get(k) ?? null;
    const y = inB.get(k) ?? null;
    if (claimText(x) === claimText(y)) continue;
    claims.push({ span: { start: c.span.start, end: c.span.end }, discover: x, confirm: y });
  }
  claims.sort((x, y) => x.span.start - y.span.start || x.span.end - y.span.end);
  return { functions, claims };
}

/** How many differ of each, and the first few, for a message (code-quality-r0-3). */
export function summarize(d: ViewDifferences, first = 4): string {
  const shown = [...d.functions.slice(0, first).map(fnDiffText), ...d.claims.slice(0, first).map(claimDiffText)];
  const more = d.functions.length > first || d.claims.length > first ? '; …' : '';
  return `${d.functions.length} functions and ${d.claims.length} claim runs differ: ${shown.join('; ')}${more}`;
}

/** The verdict on one ROM: problems (empty when it passes) and, for a ROM with a known limitation, the note it prints. */
export function judgeDifferences(
  name: string,
  dataset: { readonly sha1: string; readonly elfSha256?: string | undefined },
  d: ViewDifferences,
  known: Readonly<Record<string, KnownDifferences>> = KNOWN_DIFFERENCES,
): { readonly problems: readonly string[]; readonly note?: string } {
  const k = known[name];
  const empty = d.functions.length === 0 && d.claims.length === 0;
  if (k === undefined) return empty ? { problems: [] } : { problems: [`${name}: ${summarize(d)}`] };
  const unbound = bindingMismatch(name, k.decision, k.rom, dataset);
  if (unbound !== undefined) return { problems: [unbound, ...(empty ? [] : [`${name}: ${summarize(d)}`])] };

  const problems: string[] = [];
  const actualFn = new Map(d.functions.map((f) => [f.entry, f]));
  const knownFn = new Set(k.functions.map((f) => f.entry));
  const gone = k.functions.filter((f) => !actualFn.has(f.entry));
  const changed = k.functions.filter((f) => {
    const got = actualFn.get(f.entry);
    return got !== undefined && fnDiffText(got) !== fnDiffText(f);
  });
  for (const f of d.functions.filter((x) => !knownFn.has(x.entry))) {
    const why = k.notCovered?.[f.entry];
    problems.push(`${name}: ${fnDiffText(f)}: not covered by ${k.decision}${why === undefined ? '' : `, ${why}`}`);
  }
  for (const f of changed) problems.push(`${name}: the known difference changed (${k.decision}): ${fnDiffText(actualFn.get(f.entry) ?? f)}; recorded ${fnDiffText(f)}`);
  if (gone.length > 0) problems.push(`${name}: known differences no longer differ, the record is stale (${k.decision}): ${gone.map((f) => hex(f.entry)).join(', ')}`);

  const actualClaim = new Map(d.claims.map((c) => [spanKey(c.span), c]));
  const knownClaim = new Set(k.claims.map((c) => spanKey(c.span)));
  const extraClaims = d.claims.filter((c) => !knownClaim.has(spanKey(c.span)));
  const goneClaims = k.claims.filter((c) => !actualClaim.has(spanKey(c.span)));
  const changedClaims = k.claims.filter((c) => {
    const got = actualClaim.get(spanKey(c.span));
    return got !== undefined && claimDiffText(got) !== claimDiffText(c);
  });
  if (extraClaims.length > 0) problems.push(`${name}: ${extraClaims.length} claim runs differ, not covered by ${k.decision}: ${extraClaims.slice(0, 4).map(claimDiffText).join('; ')}`);
  for (const c of changedClaims) problems.push(`${name}: the known claim difference changed (${k.decision}): ${claimDiffText(actualClaim.get(spanKey(c.span)) ?? c)}; recorded ${claimDiffText(c)}`);
  if (goneClaims.length > 0) problems.push(`${name}: known claim differences no longer differ, the record is stale (${k.decision}): ${goneClaims.map((c) => span(c.span)).join(', ')}`);

  const held = k.functions.length - gone.length - changed.length;
  const heldClaims = k.claims.length - goneClaims.length - changedClaims.length;
  return {
    problems,
    note:
      `${name}: ${held} of ${k.functions.length} known functions differ as recorded (${k.functions.map((f) => hex(f.entry)).join(', ')}), ` +
      `${heldClaims} of ${k.claims.length} known claim runs (${k.claims.map((c) => span(c.span)).join(', ')}): ${k.reason}, ${k.decision}`,
  };
}

/** Known limitations whose ROM is not a tuning dataset: each a stale record (code-quality-r0-1). */
export function staleRecords(tuning: readonly string[], known: Readonly<Record<string, KnownDifferences>> = KNOWN_DIFFERENCES): readonly string[] {
  return Object.keys(known)
    .sort(byCodeUnit)
    .filter((name) => !tuning.includes(name))
    .map((name) => `${name}: a known limitation (${known[name]?.decision ?? '?'}) is recorded but ${name} is not a tuning dataset, the record is stale`);
}
