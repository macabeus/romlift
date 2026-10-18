// The comparison of g2.confirm-equals-discover (architecture §4.2, D8, D61 e), in one place: the gate calls
// it and test/unit/gates/confirm-differences.test.ts tests it. Two parity views (functions with their
// extents and far `bl` verdicts, and claim runs) are compared in full: every function that differs (in one
// view only, or with another mode, extent or far verdicts) and every claim run that differs.
//
// The owner's answer to Q3 of phase-2.md (18 October 2026, "Build resettle, else accept"): D8's resettle
// stage was built and measured (f287b0d) and reverted (af0f75c) because it changes rows on the other tuning
// ROMs and the sealed pair, so tmc's differences are a known phase-2 limitation (KNOWN_DIFFERENCES). The
// gate accepts a ROM's differences only when they are exactly its known functions (no more, no fewer: a
// difference gone is a stale record) and every differing claim run lies inside the extent of one of them
// in either view; it prints them every time. Every other ROM must have no difference at all.

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

export interface ViewDifferences {
  /** Entries of the functions that differ, ascending. */
  readonly functions: readonly number[];
  /** Claim runs (by span) present in one view and not, equal, in the other, ascending by start. */
  readonly claims: readonly { readonly start: number; readonly end: number }[];
  /** The first difference in words, for the message. */
  readonly first?: string;
}

/** A ROM whose confirm and discover views differ by a recorded limitation. */
export interface KnownDifferences {
  readonly decision: string;
  readonly reason: string;
  readonly functions: readonly number[];
  /** Why a difference beyond `functions` is not covered, printed with its failure. */
  readonly beyond?: string;
}

/**
 * tmc's six differences (D61 e), the six Q3 named: functions of hand-written code with several entries,
 * whose shared code goes to whichever entry is taken first (D60 k), so confirm, which takes every listed
 * entry from round 0, cuts them where discover does not. Nothing else is covered.
 */
export const KNOWN_DIFFERENCES: Readonly<Record<string, KnownDifferences>> = {
  tmc: {
    decision: 'D61 e',
    reason:
      'known phase-2 limitation (the owner\'s answer to Q3 on 2026-10-18, "Build resettle, else accept": the resettle stage changed rows on the other tuning ROMs and the sealed pair and was reverted)',
    functions: [0x0800_4274, 0x0800_42b8, 0x0800_42ba, 0x0800_43ac, 0x0800_8790, 0x080b_1a8c],
    beyond:
      'not covered: Q3 named six differing functions, measured at 9c8b282; these come from the pool boundary of 95b257b, after that count, and are owner question Q6 of phase-2.md',
  },
};

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

const key = (x: unknown): string => JSON.stringify(x);

/** Every difference between the discover and the confirm view. */
export function viewDifferences(discover: ParityView, confirm: ParityView): ViewDifferences {
  const a = new Map(discover.functions.map((f) => [f.entry, f]));
  const b = new Map(confirm.functions.map((f) => [f.entry, f]));
  const functions: number[] = [];
  let first: string | undefined;
  for (const entry of [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y)) {
    const x = a.get(entry);
    const y = b.get(entry);
    if (x !== undefined && y !== undefined && key(x) === key(y)) continue;
    functions.push(entry);
    first ??= `function ${hex(entry)}: discover ${x === undefined ? 'none' : key(x)}, confirm ${y === undefined ? 'none' : key(y)}`;
  }
  const inA = new Map(discover.claims.map((c) => [key(c.span), key(c)]));
  const inB = new Map(confirm.claims.map((c) => [key(c.span), key(c)]));
  const claims: { start: number; end: number }[] = [];
  for (const c of [...discover.claims, ...confirm.claims]) {
    const k = key(c.span);
    if (inA.get(k) === inB.get(k)) continue;
    if (claims.some((d) => d.start === c.span.start && d.end === c.span.end)) continue;
    claims.push({ start: c.span.start, end: c.span.end });
    first ??= `claim ${hex(c.span.start)}..${hex(c.span.end)}: discover ${inA.get(k) ?? 'none'}, confirm ${inB.get(k) ?? 'none'}`;
  }
  claims.sort((x, y) => x.start - y.start || x.end - y.end);
  return { functions, claims, ...(first === undefined ? {} : { first }) };
}

/** The verdict on one ROM: problems (empty when it passes) and the note it prints. */
export function judgeDifferences(
  name: string,
  d: ViewDifferences,
  views: { readonly discover: ParityView; readonly confirm: ParityView },
  known: Readonly<Record<string, KnownDifferences>> = KNOWN_DIFFERENCES,
): { readonly problems: readonly string[]; readonly note?: string } {
  const k = known[name];
  if (k === undefined) return d.functions.length === 0 && d.claims.length === 0 ? { problems: [] } : { problems: [`${name}: ${d.first ?? 'the views differ'}`] };
  const problems: string[] = [];
  const extra = d.functions.filter((e) => !k.functions.includes(e));
  const gone = k.functions.filter((e) => !d.functions.includes(e));
  if (extra.length > 0) problems.push(`${name}: functions differ beyond the known limitation (${k.decision}, ${k.functions.length} functions): ${extra.map(hex).join(', ')}${k.beyond === undefined ? '' : ` (${k.beyond})`}`);
  if (gone.length > 0) problems.push(`${name}: known differences no longer differ, the record is stale (${k.decision}): ${gone.map(hex).join(', ')}`);
  const extents = [...views.discover.functions, ...views.confirm.functions].filter((f) => k.functions.includes(f.entry)).map((f) => f.extent);
  const outside = d.claims.filter((c) => !extents.some((x) => c.start >= x.start && c.end <= x.end));
  if (outside.length > 0) problems.push(`${name}: claim runs differ outside the known functions' extents: ${outside.slice(0, 4).map((c) => `${hex(c.start)}..${hex(c.end)}`).join(', ')}`);
  return {
    problems,
    note: `${name}: ${d.functions.length - extra.length} known functions differ (${d.functions.filter((e) => k.functions.includes(e)).map(hex).join(', ')}) with ${d.claims.length - outside.length} claim runs inside their extents: ${k.reason}, ${k.decision}`,
  };
}
