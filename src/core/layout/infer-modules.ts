// Module inference (architecture §6.2, D20, D62 d): the modules `init` (and, in phase 3, configFromDiscover)
// proposes, in ROM order. `rom_header` holds the cartridge header and `crt0` the startup region; then one
// assembly module per library region it is given (signatures, phase 6; none before), one assembly-only module
// `asm_<ADDR>` per run of code agbcc cannot have produced (borders.ts asmOnlyRanges, widened to the legal
// borders around it, adjacent ones merged), and the remaining agbcc-shaped code cut into C modules `main`,
// `main_2`, ... (the PoC's names), each closed at the first legal border at least `moduleSize` bytes past its
// start; `data` from the code end. Every start is a legal border (borders.ts), so the model accepts the result.
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hex } from '../../foundation/util/hex.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import type { LayoutReason, Proposal, ProposalSource } from '../proposals/types.ts';
import { codeLayout } from './borders.ts';
import type { CodeLayout } from './borders.ts';
import { DEFAULT_MODULE_SIZE } from './types.ts';
import type { InferModulesOptions } from './types.ts';

type ModuleProposal = Extract<Proposal, { readonly kind: 'module' }>;

/** A fixed range of the code region: a library, or assembly-only code. */
interface FixedRange {
  readonly span: Span;
  readonly library?: { readonly name: string; readonly version: string };
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

/** The library ranges, widened to legal borders inside [from, to), in ROM order, overlaps dropped. */
function libraryRanges(layout: CodeLayout, options: InferModulesOptions, from: Addr, to: Addr): FixedRange[] {
  const out: FixedRange[] = [];
  const regions = [...(options.libraries ?? [])].sort((a, b) => compareNumbers(a.span.start, b.span.start));
  let floor = from;
  for (const r of regions) {
    const start = borderAtOrBelow(layout.borders, Math.max(r.span.start, floor), floor);
    const end = borderAtOrAbove(layout.borders, Math.min(r.span.end, to), to);
    if (start >= end || start < floor) continue;
    out.push({ span: { start, end }, library: { name: r.library, version: r.version } });
    floor = end;
  }
  return out;
}

/** The assembly-only ranges widened to legal borders inside [from, to), outside the libraries, merged when they touch. */
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
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((starts[mid] ?? 0) < start) lo = mid + 1;
    else hi = mid;
  }
  return lo < starts.length && (starts[lo] ?? 0) < end;
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

  const libraries = libraryRanges(layout, options, regionStart, regionEnd);
  const fixed = [...libraries, ...asmOnlyModules(layout, libraries, regionStart, regionEnd)].sort((a, b) => compareNumbers(a.span.start, b.span.start));

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
      if (library === undefined) {
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
      if (previous?.name === 'rom_header' && next?.fixed !== undefined) {
        pieces[i + 1] = { span: { start, end: next.span.end }, fixed: next.fixed };
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
