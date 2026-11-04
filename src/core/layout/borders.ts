// Legal module borders (architecture §6.2, D15, D20, D62). A module is its own object, and ld word-aligns every
// object, so a border must be a word-aligned chunk start; a short Thumb branch (b, bcc) cannot reach across
// objects on every binutils version, so no such branch may cross a border; and a PC-relative load or adr (Thumb
// `ldr rd, [pc, #]` and `add rd, pc, #`, ARM `ldr rd, [pc, #]` and `adr`) has no relocation GNU as can emit
// for a symbol in another object, so none may cross a border either (D63). That is the whole rule (D109): a border
// inside a run of code agbcc cannot have produced (ARM code, a Thumb entry at 2 mod 4, a shared tail, a tiled hole,
// a `bx pc` stub) is legal too when nothing crosses it, since the modules link back to back and every reference
// across them is a relocation `ld` resolves. Module inference still proposes one assembly-only module per such run
// (asm-only.ts, infer-modules.ts); the user may split it, as a project mirroring the original files does.
//
// The code region is tiled exactly as the model tiles it (tiling.ts tileCode, which core/model/chunks.ts calls):
// the cartridge header [base, base + 0xC0), then from the header's end to the data start one function chunk per
// entry that is not a label (entries.ts) and one orphan chunk for the bytes between, cut at the startup region's
// end. The data start is the analysis' code end rounded up to a word, past any word the code loads PC-relative
// beyond it (D63). The references come from refs.ts, the assembly-only ranges from asm-only.ts.
//
// A module may also start anywhere in the data region (D75 a): at or past the data start no instruction lies, so no
// branch, PC-relative load or adr can cross a word-aligned start there. isLegalStart is the whole rule, the code
// region's borders and that data-start clause together, and every reader of a module start asks it: core/model's
// E_MODULE_BORDER and its nearest-border message, `update`'s check of its patch, g4.toml-mutations and its
// property test (architecture-r1-3).
//
// This file is core/model's one entry into core/layout (architecture §2): it re-exports what the model uses of
// its sibling files.
//
// The borders rest only on ARM words and the ROM layout, not on a compiler profile: buildModel, which has no
// profile, must compute the same set as init and the TOML patcher (D62).
import { HEADER_END } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { alignWord, WORD } from './align.ts';
import { asmOnlyRanges } from './asm-only.ts';
import { factsByEntry, listedEntriesOf, placeEntries } from './entries.ts';
import { borderRefs } from './refs.ts';
import type { ShortBranch } from './refs.ts';
import { tileCode } from './tiling.ts';
import type { TiledChunk } from './tiling.ts';

// What core/model and core/workflow use of the sibling files, through this one entry.
export { appliedOverrides, coveredEntries, factsByEntry, headerCoveredEntries, isLabelEntry, placeEntries } from './entries.ts';
export type { ExtentSource, ListedEntry, PlacedEntry } from './entries.ts';
export { tileCode } from './tiling.ts';
export { alignWord, WORD } from './align.ts';

/** The first address past the cartridge header. */
function headerEndOf(rom: Pick<Rom, 'base' | 'end'>): Addr {
  return Math.min(rom.base + HEADER_END, rom.end);
}

// ---------------------------------------------------------------------------------------------------
// The layout.

/**
 * What a module start is checked against: the legal borders of the code region, where data starts and where the ROM
 * ends. A CodeLayout is one; isLegalStart reads nothing else.
 */
export interface BorderRule {
  /** The legal borders of the code region, ascending: the ROM base, the header's end, the chunk starts no reference crosses and the data start. */
  readonly borders: readonly Addr[];
  /** Every word-aligned address from here to the ROM end is a legal start too (D75 a). */
  readonly dataStart: Addr;
  /** The ROM end, where no module starts. */
  readonly end: Addr;
  /**
   * Why `a` is no legal start, for E_MODULE_BORDER's message: it is not word-aligned, it is no chunk start, or a
   * reference crosses it (the first one, by site); undefined when it is legal or the rule cannot tell (a rule built by
   * hand, in a test).
   */
  readonly why?: (a: Addr) => string | undefined;
}

export interface CodeLayout extends BorderRule {
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
  /** The assembly-only ranges past the startup region: what module inference proposes as asm modules; no border rule (D109). */
  readonly asmOnly: readonly Span[];
}

/** The first index of `sorted` holding a value above `a`. */
function firstAbove(sorted: readonly Addr[], a: Addr): number {
  return lowerBound(sorted, a + 1, (x) => x);
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
  const codeEnd = alignWord(Math.max(analysis.codeEnd, headerEnd));
  const refs = borderRefs(rom, analysis);
  const pcRelative = refs.pcRelative;
  const dataStart = Math.min(rom.end, alignWord(pcRelative.reduce((end, r) => (r.site < codeEnd && r.target >= end ? r.target + 1 : end), codeEnd)));
  const startupEnd = Math.min(dataStart, Math.max(headerEnd, analysis.startup.span.end));
  const placed = placeEntries(listedEntriesOf(analysis, headerEnd), analysis).filter((p) => !p.label);
  const chunks = tileCode(placed, headerEnd, dataStart, [startupEnd]);
  const asmOnly = asmOnlyRanges(chunks, factsByEntry(analysis), startupEnd);

  const candidates = [rom.base, ...(headerEnd < rom.end ? [headerEnd] : []), ...chunks.map((c) => c.span.start), ...(dataStart < rom.end ? [dataStart] : [])]
    .sort(compareNumbers)
    .filter((a, i, all) => i === 0 || all[i - 1] !== a);
  const free = uncrossed(candidates, [...refs.shortBranches, ...pcRelative]);
  const borders = candidates.filter((a, i) => a % WORD === 0 && free[i] === true);
  const rule: BorderRule = { borders, dataStart, end: rom.end };
  const why = (a: Addr): string | undefined => {
    if (isLegalStart(rule, a)) return undefined;
    if (a % WORD !== 0) return 'it is not word-aligned, and ld word-aligns every object';
    if (candidates[firstAbove(candidates, a) - 1] !== a) return 'no function or orphan chunk starts there';
    const crosses = (r: ShortBranch): boolean => a > Math.min(r.site, r.target) && a <= Math.max(r.site, r.target);
    const branch = refs.shortBranches.find(crosses);
    if (branch !== undefined) return `the short branch at ${hexAddr(branch.site)} to ${hexAddr(branch.target)} crosses it, and a short branch cannot reach another object`;
    const load = pcRelative.find(crosses);
    if (load !== undefined) return `the PC-relative load or adr at ${hexAddr(load.site)} of ${hexAddr(load.target)} crosses it, and as has no relocation for one into another object`;
    return undefined;
  };
  return { headerEnd, startupEnd, dataStart, end: rom.end, chunks, asmOnly, borders, why };
}

/** Whether `a` is a word in the data region of `rule`: at or past the data start, before the ROM end (D75 a). */
function inDataRegion(rule: BorderRule, a: Addr): boolean {
  return a >= rule.dataStart && a < rule.end && a % WORD === 0;
}

/**
 * Whether a module may start at `a`: one of the code region's legal borders, or any word from the data start to the
 * ROM end (D75 a: that is how the TOML keeps its data border when the confirm run's code ends lower than discover's,
 * after the user deleted the last listed function).
 */
export function isLegalStart(rule: BorderRule, a: Addr): boolean {
  if (inDataRegion(rule, a)) return true;
  const i = firstAbove(rule.borders, a);
  return rule.borders[i - 1] === a;
}

/** The legal starts strictly inside (`after`, `before`), ascending: the borders there, then every word of the data region there. */
export function legalStartsBetween(rule: BorderRule, after: Addr, before: Addr): readonly Addr[] {
  const out = rule.borders.filter((b) => b > after && b < before && !inDataRegion(rule, b));
  for (let a = alignWord(Math.max(after + 1, rule.dataStart)); a < Math.min(before, rule.end); a += WORD) out.push(a);
  return out.sort(compareNumbers);
}

/**
 * The legal module borders of an analysis below its data region, ascending, and the data start: the ROM base, the
 * header's end, the word-aligned chunk starts of the code region and the data start, without those a short Thumb
 * branch or a PC-relative load or adr crosses (D63, D109). These are
 * the starts isLegalStart allows below the data start; past it every word is legal too, which no list holds.
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

/** The nearest legal starts below and above `a` under `rule` (isLegalStart), either undefined when there is none. */
export function nearestLegalStarts(rule: BorderRule, a: Addr): { readonly below: Addr | undefined; readonly above: Addr | undefined } {
  const near = nearestBorders(rule.borders, a);
  // The nearest words below and above `a`; the first word of the data region when `a` lies before it.
  const wordBelow = alignWord(a) - WORD;
  const firstData = alignWord(rule.dataStart);
  const wordAbove = Math.max(alignWord(a + 1), firstData);
  const dataBelow = inDataRegion(rule, wordBelow) ? wordBelow : undefined;
  const dataAbove = inDataRegion(rule, wordAbove) ? wordAbove : undefined;
  const pick = (x: Addr | undefined, y: Addr | undefined, f: (p: Addr, q: Addr) => Addr): Addr | undefined => (x === undefined ? y : y === undefined ? x : f(x, y));
  return { below: pick(near.below, dataBelow, Math.max), above: pick(near.above, dataAbove, Math.min) };
}
