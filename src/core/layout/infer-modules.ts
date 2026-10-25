// Module inference (architecture §6.2, §6.7, §7.3, D20, D62 d): the modules `init` (and, in phase 3, configFromDiscover)
// proposes, in ROM order. `rom_header` holds the cartridge header and `crt0` the startup region; then one assembly
// module `ram_<RUNADDR>` per hand-written runs_at range it is given (exactly its span: a range that runs from RAM is
// its own module, §6.7), the assembly modules of the library regions the signatures placed (phase 6; placeLibraries:
// each region shrunk to the legal borders inside it, never widened over a neighbour's code, and cut around every
// runs_at range; a region that keeps no legal border is left out), one assembly-only module `asm_<ADDR>` per run of
// code agbcc cannot have produced (borders.ts asmOnlyRanges, widened to the legal borders around it, adjacent ones
// merged), and the remaining agbcc-shaped code cut into C modules `main`, `main_2`, ... (the PoC's names), each
// closed at the first legal border at least `moduleSize` bytes past its start; `data` from the code end. Every
// start but a runs_at range's is a legal border (borders.ts isLegalStart), so the model accepts the result; a runs_at
// range's borders are the user's, which the model checks (E_OVERRIDE_INVALID).
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hex } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import type { LayoutReason, LibraryRegion, Proposal, ProposalSource } from '../proposals/types.ts';
import { codeLayout, isLegalStart } from './borders.ts';
import type { CodeLayout } from './borders.ts';
import { DEFAULT_MODULE_SIZE } from './types.ts';
import type { InferModulesOptions, RunsAtRange } from './types.ts';

type ModuleProposal = Extract<Proposal, { readonly kind: 'module' }>;

/** A fixed range of the code region: a runs_at range, a library, or assembly-only code. */
interface FixedRange {
  readonly span: Span;
  readonly library?: { readonly name: string; readonly version: string };
  /** A runs_at range's run address. */
  readonly runAt?: Addr;
}

function layoutSource(reason: LayoutReason): ProposalSource {
  return { kind: 'layout', reason };
}

/** The largest border at or below `a`, never below `floor`. */
function borderAtOrBelow(borders: readonly Addr[], a: Addr, floor: Addr): Addr {
  let found = floor;
  for (const b of borders) {
    if (b > a) break;
    if (b >= floor) found = b;
  }
  return found;
}

/** The smallest border at or above `a`, never above `ceiling`. */
function borderAtOrAbove(borders: readonly Addr[], a: Addr, ceiling: Addr): Addr {
  for (const b of borders) if (b >= a) return Math.min(b, ceiling);
  return ceiling;
}

/** Why placeLibraries gives a region no module range. */
export type LibraryDropReason = 'outside-code' | 'no-legal-border';

/** Where one library region goes: the module ranges it takes, in ROM order, or why it takes none. */
export interface LibraryPlacement {
  readonly region: LibraryRegion;
  /** Empty when the region takes no module (`dropped` says why). */
  readonly spans: readonly Span[];
  readonly dropped?: LibraryDropReason;
}

/** `span` without the parts `holes` cover, in order; empty parts left out. */
function without(span: Span, holes: readonly Span[]): Span[] {
  let parts: Span[] = [span];
  for (const h of holes) {
    parts = parts.flatMap((p) => {
      if (h.end <= p.start || h.start >= p.end) return [p];
      return [...(p.start < h.start ? [{ start: p.start, end: h.start }] : []), ...(h.end < p.end ? [{ start: h.end, end: p.end }] : [])];
    });
  }
  return parts;
}

/**
 * The module ranges of the library regions inside [from, to), in region order (start, then library), never
 * overlapping: each region shrunk to legal borders (isLegalStart) inside it, so it never takes a neighbour's
 * function: it starts at the first legal border at or past its start, and ends at the first legal border at or past
 * its end when only padding or orphan bytes lie between, else at the last legal border at or below its end; then
 * cut around `around` (the runs_at ranges, which stay their own modules). A region outside [from, to) (a table past
 * the code end) is 'outside-code'; one that keeps no legal border between its shrunk ends, 'no-legal-border'.
 */
export function placeLibraries(layout: CodeLayout, regions: readonly LibraryRegion[], from: Addr, to: Addr, around: readonly Span[] = []): readonly LibraryPlacement[] {
  const starts = layout.chunks.flatMap((c) => (c.entry === undefined ? [] : [c.span.start]));
  const legal = layout.borders.filter((b) => b >= from && b <= to && isLegalStart(layout, b));
  const holes = [...around].sort((a, b) => compareNumbers(a.start, b.start));
  const ordered = [...regions].sort((a, b) => compareNumbers(a.span.start, b.span.start) || compareCodeUnits(a.library, b.library));
  const out: LibraryPlacement[] = [];
  let floor = from;
  for (const region of ordered) {
    if (region.span.end <= from || region.span.start >= to) {
      out.push({ region, spans: [], dropped: 'outside-code' });
      continue;
    }
    const first = Math.max(region.span.start, floor);
    const last = Math.min(region.span.end, to);
    const start = legal.find((b) => b >= first);
    const up = legal.find((b) => b >= last) ?? to;
    const below = [...legal].reverse().find((b) => b <= last);
    const end = hasFunction(starts, last, up) ? below : up;
    if (start === undefined || end === undefined || start >= end) {
      out.push({ region, spans: [], dropped: 'no-legal-border' });
      continue;
    }
    out.push({ region, spans: without({ start, end }, holes) });
    floor = end;
  }
  return out;
}

/** The runs_at ranges inside [from, to), in ROM order, as fixed ranges. */
function runsAtRanges(ranges: readonly RunsAtRange[], from: Addr, to: Addr): FixedRange[] {
  return ranges
    .filter((r) => r.span.start >= from && r.span.end <= to && r.span.start < r.span.end)
    .map((r) => ({ span: r.span, runAt: r.runAt }))
    .sort((a, b) => compareNumbers(a.span.start, b.span.start));
}

/** The assembly-only ranges widened to legal borders inside [from, to), outside the other fixed ranges, merged when they touch. */
function asmOnlyModules(layout: CodeLayout, libraries: readonly FixedRange[], from: Addr, to: Addr): FixedRange[] {
  const widened = layout.asmOnly
    .map((r) => ({ start: borderAtOrBelow(layout.borders, Math.max(r.start, from), from), end: borderAtOrAbove(layout.borders, Math.min(r.end, to), to) }))
    .filter((r) => r.start < r.end);
  const pieces: Span[] = [];
  for (const r of widened) {
    // A library keeps its range: what is left of the assembly-only range on either side stays assembly-only.
    let parts: Span[] = [r];
    for (const lib of libraries) {
      parts = parts.flatMap((p) => {
        if (lib.span.end <= p.start || lib.span.start >= p.end) return [p];
        return [
          ...(p.start < lib.span.start ? [{ start: p.start, end: lib.span.start }] : []),
          ...(lib.span.end < p.end ? [{ start: lib.span.end, end: p.end }] : []),
        ];
      });
    }
    pieces.push(...parts);
  }
  pieces.sort((a, b) => compareNumbers(a.start, b.start));
  const merged: { start: Addr; end: Addr }[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && p.start <= last.end) last.end = Math.max(last.end, p.end);
    else merged.push({ start: p.start, end: p.end });
  }
  return merged.map((span) => ({ span }));
}

/** Whether a function chunk starts in [start, end); `starts` are the function chunks' starts, ascending. */
function hasFunction(starts: readonly Addr[], start: Addr, end: Addr): boolean {
  const at = starts[lowerBound(starts, start, (a) => a)];
  return at !== undefined && at < end;
}

/** The starts of the C modules of one stretch [start, end) of agbcc-shaped code. */
function cuts(layout: CodeLayout, starts: readonly Addr[], start: Addr, end: Addr, moduleSize: number): Addr[] {
  const out = [start];
  let current = start;
  for (const b of layout.borders) {
    if (b <= current || b >= end) continue;
    if (b - current >= moduleSize && hasFunction(starts, b, end)) {
      out.push(b);
      current = b;
    }
  }
  return out;
}

/** The module name `asm_<ADDR>` of an assembly-only range. */
export function asmOnlyName(start: Addr): string {
  return `asm_${hex(start)}`;
}

/** The module name `ram_<RUNADDR>` of a runs_at range (eight upper-case hex digits of its run address). */
export function runsAtName(runAt: Addr): string {
  return `ram_${hex(runAt)}`;
}

/** The name of the n-th agbcc-shaped module (1-based): main, main_2, main_3, ... */
export function mainName(n: number): string {
  return n === 1 ? 'main' : `main_${n}`;
}

/**
 * The module proposals of a ROM and its analysis, in ROM order: every start a legal border, the first at the ROM
 * base. Module kinds: 'asm' for the header, crt0, libraries and assembly-only code, 'c' for agbcc-shaped code,
 * 'data' from the code end.
 */
export function inferModules(rom: Rom, analysis: AnalysisResult, options: InferModulesOptions = {}): readonly Proposal[] {
  const layout = codeLayout(rom, analysis);
  const starts = layout.chunks.flatMap((c) => (c.entry === undefined ? [] : [c.span.start]));
  const moduleSize = options.moduleSize ?? DEFAULT_MODULE_SIZE;
  const out: ModuleProposal[] = [{ kind: 'module', name: 'rom_header', start: rom.base, moduleKind: 'asm', source: layoutSource('header') }];
  if (layout.headerEnd >= rom.end) return out;

  let regionStart = layout.headerEnd;
  if (layout.startupEnd > layout.headerEnd) {
    out.push({ kind: 'module', name: 'crt0', start: layout.headerEnd, moduleKind: 'asm', source: layoutSource('startup') });
    regionStart = borderAtOrAbove(layout.borders, layout.startupEnd, layout.dataStart);
  }
  const regionEnd = layout.dataStart;

  const ram = runsAtRanges(options.runsAt ?? [], regionStart, regionEnd);
  const libraries: FixedRange[] = placeLibraries(layout, options.libraries ?? [], regionStart, regionEnd, ram.map((r) => r.span)).flatMap((p) =>
    p.spans.map((span) => ({ span, library: { name: p.region.library, version: p.region.version } })),
  );
  const taken = [...ram, ...libraries];
  const fixed = [...taken, ...asmOnlyModules(layout, taken, regionStart, regionEnd)].sort((a, b) => compareNumbers(a.span.start, b.span.start));

  // The stretches between fixed ranges hold the agbcc-shaped code.
  const pieces: { readonly span: Span; readonly fixed?: FixedRange }[] = [];
  let at = regionStart;
  for (const f of fixed) {
    if (f.span.start > at) pieces.push({ span: { start: at, end: f.span.start } });
    pieces.push({ span: f.span, fixed: f });
    at = f.span.end;
  }
  if (at < regionEnd) pieces.push({ span: { start: at, end: regionEnd } });

  let mains = 0;
  const libraryNames = new Map<string, number>();
  for (const [i, piece] of pieces.entries()) {
    const { start, end } = piece.span;
    if (piece.fixed !== undefined) {
      const library = piece.fixed.library;
      if (piece.fixed.runAt !== undefined) {
        out.push({ kind: 'module', name: runsAtName(piece.fixed.runAt), start, moduleKind: 'asm', source: layoutSource('runs-at') });
      } else if (library === undefined) {
        out.push({ kind: 'module', name: asmOnlyName(start), start, moduleKind: 'asm', source: layoutSource('asm-only') });
      } else {
        const seen = (libraryNames.get(library.name) ?? 0) + 1;
        libraryNames.set(library.name, seen);
        const name = seen === 1 ? library.name : `${library.name}_${seen}`;
        out.push({ kind: 'module', name, start, moduleKind: 'asm', library, source: layoutSource('asm-only') });
      }
      continue;
    }
    if (!hasFunction(starts, start, end)) {
      // Orphan bytes alone make no module: they join the module before them, or the next one after the header.
      const previous = out[out.length - 1];
      const next = pieces[i + 1];
      if (previous?.name === 'rom_header' && next?.fixed !== undefined && next.fixed.runAt === undefined) {
        pieces[i + 1] = { span: { start, end: next.span.end }, fixed: next.fixed };
        continue;
      }
      // A runs_at range ends where its module does, so the bytes after it take a module of their own.
      if (previous?.source.kind === 'layout' && previous.source.reason === 'runs-at') {
        out.push({ kind: 'module', name: asmOnlyName(start), start, moduleKind: 'asm', source: layoutSource('asm-only') });
        continue;
      }
      if (previous !== undefined && previous.name !== 'rom_header') continue;
    }
    for (const s of cuts(layout, starts, start, end, moduleSize)) {
      mains += 1;
      out.push({ kind: 'module', name: mainName(mains), start: s, moduleKind: 'c', source: layoutSource('module-size') });
    }
  }
  if (layout.dataStart < rom.end) out.push({ kind: 'module', name: 'data', start: layout.dataStart, moduleKind: 'data', source: layoutSource('data') });
  return out;
}
