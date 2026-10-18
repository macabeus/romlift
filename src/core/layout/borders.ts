// Legal module borders (architecture §6.2, D15, D20, D62). A module is its own object, and ld word-aligns every
// object, so a border must be a word-aligned chunk start; a short Thumb branch (b, bcc) cannot reach across
// objects on every binutils version, so no such branch may cross a border; a PC-relative load or adr (Thumb
// `ldr rd, [pc, #]` and `add rd, pc, #`, ARM `ldr rd, [pc, #]` and `adr`) has no relocation GNU as can emit
// for a symbol in another object, so none may cross a border either (D63); and a run of code agbcc cannot have
// produced (ARM code, a Thumb entry at 2 mod 4, a shared tail, a tiled hole) stays in one assembly-only
// module, so no border falls strictly inside one.
//
// The code region is tiled here exactly as the model tiles it (core/model/chunks.ts calls tileCode): the
// cartridge header [base, base + 0xC0), then from the header's end to the data start one function chunk per
// entry that is not a label (start = entry, end = min(extent end, next chunk start), at least 2 bytes, the
// PoC's tile()) and one orphan chunk for the bytes between, cut at the startup region's end. The data start is
// the analysis' code end rounded up to a word, past any word the code loads PC-relative beyond it (D63).
//
// The borders rest only on ARM words and the ROM layout, not on a compiler profile: buildModel, which has no
// profile, must compute the same set as init and the TOML patcher (D62).
import { decode } from '../../foundation/isa/decode.ts';
import type { Flow } from '../../foundation/isa/types.ts';
import { HEADER_END } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult, FunctionFact } from '../analysis/types.ts';

/** The ARM word: ld aligns every object to it, and agbcc aligns every C function to it. */
export const WORD = 4;

/** The rule whose tail exits are shared tails: a branch into another function. */
export const SHARED_TAIL_RULE = 'walk.branch-into-function';

/** `a` rounded up to a word. */
export function alignUp(a: Addr): Addr {
  return Math.ceil(a / WORD) * WORD;
}

/** The first address past the cartridge header. */
export function headerEndOf(rom: Pick<Rom, 'base' | 'end'>): Addr {
  return Math.min(rom.base + HEADER_END, rom.end);
}

// ---------------------------------------------------------------------------------------------------
// Entries and their extents.

/** Where a chunk's end comes from (ModelFunction.source.extent). */
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
}

/** The end of a function's extent with the header clipped off: the cartridge entry's extent covers the header (correctness-6). */
export function clippedExtentEnd(f: Pick<FunctionFact, 'entry' | 'extent'>, headerEnd: Addr): Addr {
  return f.entry < headerEnd ? Math.min(f.extent.end, headerEnd) : f.extent.end;
}

/** The functions of the analysis by entry. */
export function factsByEntry(analysis: Pick<AnalysisResult, 'functions'>): ReadonlyMap<Addr, FunctionFact> {
  return new Map(analysis.functions.map((f) => [f.entry, f] as const));
}

/**
 * Where each listed entry's extent ends: the size the config gives, else the analysis' extent, else a code
 * override containing it, else the next chunk start ('next-listed'). `listed` is sorted by entry.
 */
export function placeEntries(listed: readonly ListedEntry[], analysis: Pick<AnalysisResult, 'functions' | 'options'>): PlacedEntry[] {
  const facts = factsByEntry(analysis);
  const codeOverrides = analysis.options.overrides.filter((o) => o.kind === 'code');
  return listed.map((l): PlacedEntry => {
    if (l.size !== undefined) return { entry: l.entry, label: l.label, end: l.entry + l.size, source: 'toml-size' };
    const fact = facts.get(l.entry);
    if (fact !== undefined) return { entry: l.entry, label: l.label, end: fact.extent.end, source: 'analysis' };
    const override = codeOverrides.find((o) => l.entry >= o.span.start && l.entry < o.span.end);
    if (override !== undefined) return { entry: l.entry, label: l.label, end: override.span.end, source: 'override' };
    return { entry: l.entry, label: l.label, end: undefined, source: 'next-listed' };
  });
}

/**
 * The entries of `functions` (sorted by entry) that lie strictly inside an earlier function's extent, the
 * header clipped off the cartridge entry's: configFromDiscover lists them with `label = true`.
 */
export function nestedEntries(functions: readonly FunctionFact[], headerEnd: Addr): ReadonlySet<Addr> {
  const nested = new Set<Addr>();
  let reach = -Infinity;
  for (const f of functions) {
    if (f.entry < reach) nested.add(f.entry);
    reach = Math.max(reach, clippedExtentEnd(f, headerEnd));
  }
  return nested;
}

/**
 * The listed entries of an analysis: in discover mode every function, nested ones as labels; in confirm mode
 * the listed seeds (the TOML's functions), with their `label` and `size`.
 */
export function listedEntriesOf(analysis: AnalysisResult, headerEnd: Addr): ListedEntry[] {
  if (analysis.mode === 'discover') {
    const nested = nestedEntries(analysis.functions, headerEnd);
    return analysis.functions.map((f) => ({ entry: f.entry, label: nested.has(f.entry) }));
  }
  const seeds = analysis.options.seeds.filter((s) => s.rule === 'seed.listed').sort((a, b) => compareNumbers(a.entry, b.entry));
  return seeds
    .filter((s, i) => i === 0 || seeds[i - 1]?.entry !== s.entry)
    .map((s) => ({ entry: s.entry, label: s.label === true, ...(s.size === undefined ? {} : { size: s.size }) }));
}

// ---------------------------------------------------------------------------------------------------
// Tiling (the PoC's tile()).

/** One chunk of the code region: a function chunk names its entry; an orphan chunk has none. */
export interface TiledChunk {
  readonly span: Span;
  readonly entry: Addr | undefined;
}

/** The index of the first entry at or above `a` in `entries` (sorted by entry). */
function firstAtOrAbove(entries: readonly { readonly entry: Addr }[], a: Addr): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((entries[mid]?.entry ?? 0) < a) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Tiles [from, to): one function chunk per entry (start = entry, end = min(extent end, next entry), at least 2
 * bytes, never past `to`), one orphan chunk for the bytes between, orphans cut at each of `cuts`. `entries` are
 * the chunk-starting entries sorted by entry; an entry inside the previous chunk starts none (its caller makes
 * it an inner label).
 */
export function tileCode(entries: readonly PlacedEntry[], from: Addr, to: Addr, cuts: readonly Addr[]): TiledChunk[] {
  const out: TiledChunk[] = [];
  const orphan = (a: Addr, b: Addr): void => {
    let start = a;
    for (const c of cuts) {
      if (c > start && c < b) {
        out.push({ span: { start, end: c }, entry: undefined });
        start = c;
      }
    }
    if (b > start) out.push({ span: { start, end: b }, entry: undefined });
  };
  let cursor = from;
  const first = firstAtOrAbove(entries, from);
  const last = firstAtOrAbove(entries, to);
  for (let i = first; i < last; i++) {
    const e = entries[i] as PlacedEntry;
    if (e.entry < cursor) continue;
    if (e.entry > cursor) orphan(cursor, e.entry);
    const next = i + 1 < last ? (entries[i + 1] as PlacedEntry).entry : to;
    const end = Math.min(to, Math.max(e.entry + 2, Math.min(e.end ?? next, next)));
    out.push({ span: { start: e.entry, end }, entry: e.entry });
    cursor = end;
  }
  if (cursor < to) orphan(cursor, to);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Short branches and assembly-only ranges.

/** A short Thumb branch (b, bcc): its site and target. */
export interface ShortBranch {
  readonly site: Addr;
  readonly target: Addr;
}

/** Whether the Thumb halfword may be a b or bcc (the decoder decides). */
function maybeShortBranch(hw: number): boolean {
  return (hw & 0xf000) === 0xd000 || (hw & 0xf800) === 0xe000;
}

/** Whether the Thumb halfword may be a PC-relative load or an adr (the decoder decides). */
function maybePcRelative(hw: number): boolean {
  return (hw & 0xf800) === 0x4800 || (hw & 0xf800) === 0xa000;
}

/**
 * Every short Thumb branch in the code spans of the analysis' Thumb functions, decoded with foundation/isa
 * at its load address (a branch inside a runs_at range has the same offset in run space). A bl suffix or
 * prefix never looks like a b or bcc, so every halfword of a span is a candidate.
 */
export function shortBranches(rom: Rom, analysis: Pick<AnalysisResult, 'functions'>): ShortBranch[] {
  const out: ShortBranch[] = [];
  const bytes = rom.bytes;
  for (const f of analysis.functions) {
    if (f.mode !== 'thumb') continue;
    for (const span of f.code) {
      const end = Math.min(span.end, rom.end);
      for (let a = Math.max(span.start, rom.base); a + 2 <= end; a += 2) {
        const k = a - rom.base;
        const hw = (bytes[k] ?? 0) | ((bytes[k + 1] ?? 0) << 8);
        if (!maybeShortBranch(hw)) continue;
        const flow = decode('thumb', hw, a).flow;
        if (flow.kind === 'branch') out.push({ site: a, target: flow.target });
      }
    }
  }
  return out;
}

/**
 * Every PC-relative load and adr in the code spans of the analysis' functions, as a site and the address it
 * names (the pool word or the adr target), decoded at its load address like shortBranches. These are the
 * references codeRefs (core/model/labels.ts) names, so a border none of them crosses never leaves the model a
 * PC-relative instruction whose label lies in another object, which `as` cannot assemble (D63). A bl half
 * never looks like either Thumb form; an ARM span is decoded word by word.
 */
export function pcRelativeRefs(rom: Rom, analysis: Pick<AnalysisResult, 'functions'>): ShortBranch[] {
  const out: ShortBranch[] = [];
  const bytes = rom.bytes;
  const push = (site: Addr, flow: Flow): void => {
    if (flow.kind === 'pool-load') out.push({ site, target: flow.pool });
    else if (flow.kind === 'adr') out.push({ site, target: flow.target });
  };
  for (const f of analysis.functions) {
    for (const span of f.code) {
      const end = Math.min(span.end, rom.end);
      if (f.mode === 'arm') {
        for (let a = alignUp(Math.max(span.start, rom.base)); a + 4 <= end; a += 4) {
          const k = a - rom.base;
          const word = ((bytes[k] ?? 0) | ((bytes[k + 1] ?? 0) << 8) | ((bytes[k + 2] ?? 0) << 16) | ((bytes[k + 3] ?? 0) << 24)) >>> 0;
          push(a, decode('arm', word, a).flow);
        }
        continue;
      }
      for (let a = Math.max(span.start, rom.base); a + 2 <= end; a += 2) {
        const k = a - rom.base;
        const hw = (bytes[k] ?? 0) | ((bytes[k + 1] ?? 0) << 8);
        if (maybePcRelative(hw)) push(a, decode('thumb', hw, a).flow);
      }
    }
  }
  return out;
}

/** Why agbcc cannot have produced a function. */
export type AsmOnlyReason = 'arm' | 'unaligned-entry' | 'shared-tail' | 'tiled-hole';

/** The reasons a function is assembly-only; empty when agbcc may have produced it. */
export function asmOnlyReasons(f: FunctionFact): AsmOnlyReason[] {
  const reasons: AsmOnlyReason[] = [];
  if (f.mode === 'arm') reasons.push('arm');
  if (f.mode === 'thumb' && f.entry % WORD !== 0) reasons.push('unaligned-entry');
  if (f.exits.some((x) => x.kind === 'tail' && x.rule === SHARED_TAIL_RULE)) reasons.push('shared-tail');
  if (f.holes.length > 0) reasons.push('tiled-hole');
  return reasons;
}

/**
 * The assembly-only ranges among `chunks` (in address order) that start at or after `from`: each run of
 * consecutive assembly-only function chunks, with any orphan chunks between them, from the first one's start
 * to the last one's end.
 */
export function asmOnlyRanges(chunks: readonly TiledChunk[], facts: ReadonlyMap<Addr, FunctionFact>, from: Addr): Span[] {
  const out: Span[] = [];
  let open: { start: Addr; end: Addr } | undefined;
  for (const c of chunks) {
    if (c.entry === undefined || c.span.start < from) continue;
    const fact = facts.get(c.entry);
    if (fact !== undefined && asmOnlyReasons(fact).length > 0) {
      if (open === undefined) open = { start: c.span.start, end: c.span.end };
      else open.end = c.span.end;
    } else if (open !== undefined) {
      out.push(open);
      open = undefined;
    }
  }
  if (open !== undefined) out.push(open);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The layout.

export interface CodeLayout {
  /** The first address past the cartridge header. */
  readonly headerEnd: Addr;
  /** The end of the startup region (crt0), between headerEnd and dataStart; headerEnd when there is none. */
  readonly startupEnd: Addr;
  /**
   * Where data starts: the analysis' code end rounded up to a word, moved up past every pool word or adr target
   * a PC-relative reference of the code names beyond it (D63: such a word belongs with the code that loads it,
   * since `as` cannot load it from the data object); the ROM end when nothing follows.
   */
  readonly dataStart: Addr;
  /** The chunks of [headerEnd, dataStart), in address order. */
  readonly chunks: readonly TiledChunk[];
  /** The assembly-only ranges past the startup region. */
  readonly asmOnly: readonly Span[];
  /** The legal borders, ascending. */
  readonly borders: readonly Addr[];
}

/** The first index of `sorted` holding a value above `a`. */
function firstAbove(sorted: readonly Addr[], a: Addr): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) <= a) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The candidates no reference crosses: a reference from s to t crosses a border b when b is in (min, max]. */
function uncrossed(candidates: readonly Addr[], branches: readonly ShortBranch[]): boolean[] {
  const delta = new Int32Array(candidates.length + 1);
  for (const { site, target } of branches) {
    const i = firstAbove(candidates, Math.min(site, target));
    const j = firstAbove(candidates, Math.max(site, target));
    if (i < j) {
      delta[i] = (delta[i] ?? 0) + 1;
      delta[j] = (delta[j] ?? 0) - 1;
    }
  }
  const out: boolean[] = [];
  let depth = 0;
  for (let i = 0; i < candidates.length; i++) {
    depth += delta[i] ?? 0;
    out.push(depth === 0);
  }
  return out;
}

/** The code layout of an analysis: its chunks, assembly-only ranges and legal borders. */
export function codeLayout(rom: Rom, analysis: AnalysisResult): CodeLayout {
  const headerEnd = headerEndOf(rom);
  const codeEnd = alignUp(Math.max(analysis.codeEnd, headerEnd));
  const pcRelative = pcRelativeRefs(rom, analysis);
  const dataStart = Math.min(rom.end, alignUp(pcRelative.reduce((end, r) => (r.site < codeEnd && r.target >= end ? r.target + 1 : end), codeEnd)));
  const startupEnd = Math.min(dataStart, Math.max(headerEnd, analysis.startup.span.end));
  const placed = placeEntries(listedEntriesOf(analysis, headerEnd), analysis).filter((p) => !p.label);
  const chunks = tileCode(placed, headerEnd, dataStart, [startupEnd]);
  const asmOnly = asmOnlyRanges(chunks, factsByEntry(analysis), startupEnd);

  const candidates = [rom.base, ...(headerEnd < rom.end ? [headerEnd] : []), ...chunks.map((c) => c.span.start), ...(dataStart < rom.end ? [dataStart] : [])]
    .sort(compareNumbers)
    .filter((a, i, all) => i === 0 || all[i - 1] !== a);
  const free = uncrossed(candidates, [...shortBranches(rom, analysis), ...pcRelative]);
  const inside = (a: Addr): boolean => asmOnly.some((r) => a > r.start && a < r.end);
  const borders = candidates.filter((a, i) => a % WORD === 0 && free[i] === true && !inside(a));
  return { headerEnd, startupEnd, dataStart, chunks, asmOnly, borders };
}

/**
 * The legal module borders of an analysis, ascending: the ROM base, the header's end, the word-aligned chunk
 * starts of the code region and the data start, without those a short Thumb branch or a PC-relative load or
 * adr crosses (D63) or that fall strictly inside an assembly-only range. The model, init, analyze --update and the TOML patcher all use it.
 */
export function legalBorders(rom: Rom, analysis: AnalysisResult): readonly Addr[] {
  return codeLayout(rom, analysis).borders;
}

/** The nearest legal borders below and above `a` (either undefined when there is none). */
export function nearestBorders(borders: readonly Addr[], a: Addr): { readonly below: Addr | undefined; readonly above: Addr | undefined } {
  const i = firstAbove(borders, a);
  const atOrBelow = borders[i - 1];
  const below = atOrBelow === a ? borders[i - 2] : atOrBelow;
  return { below, above: borders[i] };
}
