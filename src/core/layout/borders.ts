// Legal module borders (architecture §6.2, D15, D20, D62). A module is its own object, and ld word-aligns every
// object, so a border must be a word-aligned chunk start; a short Thumb branch (b, bcc) cannot reach across
// objects on every binutils version, so no such branch may cross a border; a PC-relative load or adr (Thumb
// `ldr rd, [pc, #]` and `add rd, pc, #`, ARM `ldr rd, [pc, #]` and `adr`) has no relocation GNU as can emit
// for a symbol in another object, so none may cross a border either (D63); and a run of code agbcc cannot have
// produced (ARM code, a Thumb entry at 2 mod 4, a shared tail, a tiled hole) stays in one assembly-only
// module, so no border falls strictly inside one.
//
// The code region is tiled exactly as the model tiles it (tiling.ts tileCode, which core/model/chunks.ts calls):
// the cartridge header [base, base + 0xC0), then from the header's end to the data start one function chunk per
// entry that is not a label (entries.ts) and one orphan chunk for the bytes between, cut at the startup region's
// end. The data start is the analysis' code end rounded up to a word, past any word the code loads PC-relative
// beyond it (D63). The references come from refs.ts, the assembly-only ranges from asm-only.ts.
//
// This file is core/model's one entry into core/layout (architecture §2): it re-exports what the model uses of
// its sibling files.
//
// The borders rest only on ARM words and the ROM layout, not on a compiler profile: buildModel, which has no
// profile, must compute the same set as init and the TOML patcher (D62).
import { HEADER_END } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { alignUp, WORD } from './align.ts';
import { asmOnlyRanges } from './asm-only.ts';
import { factsByEntry, listedEntriesOf, placeEntries } from './entries.ts';
import { borderRefs } from './refs.ts';
import type { ShortBranch } from './refs.ts';
import { tileCode } from './tiling.ts';
import type { TiledChunk } from './tiling.ts';

// What core/model and core/workflow use of the sibling files, through this one entry.
export { alignUp } from './align.ts';
export { coveredEntries, factsByEntry, headerCoveredEntries, isLabelEntry, placeEntries } from './entries.ts';
export type { ExtentSource, ListedEntry, PlacedEntry } from './entries.ts';
export { tileCode } from './tiling.ts';

/** The first address past the cartridge header. */
function headerEndOf(rom: Pick<Rom, 'base' | 'end'>): Addr {
  return Math.min(rom.base + HEADER_END, rom.end);
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
  const codeEnd = alignUp(Math.max(analysis.codeEnd, headerEnd));
  const refs = borderRefs(rom, analysis);
  const pcRelative = refs.pcRelative;
  const dataStart = Math.min(rom.end, alignUp(pcRelative.reduce((end, r) => (r.site < codeEnd && r.target >= end ? r.target + 1 : end), codeEnd)));
  const startupEnd = Math.min(dataStart, Math.max(headerEnd, analysis.startup.span.end));
  const placed = placeEntries(listedEntriesOf(analysis, headerEnd), analysis).filter((p) => !p.label);
  const chunks = tileCode(placed, headerEnd, dataStart, [startupEnd]);
  const asmOnly = asmOnlyRanges(chunks, factsByEntry(analysis), startupEnd);

  const candidates = [rom.base, ...(headerEnd < rom.end ? [headerEnd] : []), ...chunks.map((c) => c.span.start), ...(dataStart < rom.end ? [dataStart] : [])]
    .sort(compareNumbers)
    .filter((a, i, all) => i === 0 || all[i - 1] !== a);
  const free = uncrossed(candidates, [...refs.shortBranches, ...pcRelative]);
  const inside = (a: Addr): boolean => asmOnly.some((r) => a > r.start && a < r.end);
  const borders = candidates.filter((a, i) => a % WORD === 0 && free[i] === true && !inside(a));
  return { headerEnd, startupEnd, dataStart, chunks, asmOnly, borders };
}

/**
 * The legal module borders of an analysis, ascending: the ROM base, the header's end, the word-aligned chunk
 * starts of the code region and the data start, without those a short Thumb branch or a PC-relative load or
 * adr crosses (D63) or that fall strictly inside an assembly-only range. Exported; no module of src calls it yet (the model uses
 * codeLayout's borders with core/model/modules.ts isLegalStart, D77 k; one owner of the rule is carried to phase 6).
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
