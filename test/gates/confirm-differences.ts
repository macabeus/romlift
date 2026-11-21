// The differences of g2.confirm-equals-discover's two views (architecture §4.2, §13, D8, D114): every function
// (entry, mode, extent, far verdicts) and every claim run that differs between the discover run and the confirm run
// seeded with its functions. Since D114 the canonical pass makes both runs read every function under the final
// function set, so the gate holds on every tuning ROM with no recorded exception: any difference fails, on any ROM.
// (D61 e and g had accepted eight tmc functions and four claim runs as a known limitation; D114 removed them.)

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

/** How many records a failure message shows of each list; it gives the list's count too (code-quality-r0-3, r1-5). */
const FIRST = 4;

/** How many differ of each, and the first few, for a message (code-quality-r0-3). */
export function summarize(d: ViewDifferences, first = FIRST): string {
  const shown = [...d.functions.slice(0, first).map(fnDiffText), ...d.claims.slice(0, first).map(claimDiffText)];
  const more = d.functions.length > first || d.claims.length > first ? '; …' : '';
  return `${d.functions.length} functions and ${d.claims.length} claim runs differ: ${shown.join('; ')}${more}`;
}

/** The verdict on one ROM: no problem when the views agree, else one naming the counts and the first differences. */
export function judgeDifferences(name: string, d: ViewDifferences): { readonly problems: readonly string[] } {
  return d.functions.length === 0 && d.claims.length === 0
    ? { problems: [] }
    : { problems: [`${name}: ${summarize(d)}`] };
}
