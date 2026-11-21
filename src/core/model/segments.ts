// What the analysis says each byte of the ROM is (architecture §6.2 step 1, D16): instructions from
// FunctionFact.code (the code spans of one mode merged first, so a bl pair is never split between two functions'
// readings), pool words from `pools` and `farPools`, table entries from the jump tables, padding (zeros up to a
// word boundary) and data from the region rules' claims, with the notes of the bytes inside extents. Where two
// facts overlap, the earlier start wins, then code over pools, tables, padding and data. items.ts turns these
// segments into the model's items.
import { contains, u32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { pushAll } from '../../foundation/util/arrays.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { Claim } from '../analysis/types.ts';
import { alignWord } from '../layout/borders.ts';
import type { DataNote } from './types.ts';

export type Segment =
  | { readonly kind: 'code'; readonly start: Addr; readonly end: Addr; readonly mode: Mode }
  | { readonly kind: 'pool'; readonly start: Addr; readonly end: Addr; readonly value: number }
  /** `first`: the entry at the table's base. */
  | {
      readonly kind: 'table';
      readonly start: Addr;
      readonly end: Addr;
      readonly target: Addr;
      readonly thumbBit: boolean;
      readonly first: boolean;
    }
  | { readonly kind: 'padding'; readonly start: Addr; readonly end: Addr }
  | { readonly kind: 'data'; readonly start: Addr; readonly end: Addr };

export interface NoteSpan {
  readonly start: Addr;
  readonly end: Addr;
  readonly note: Exclude<DataNote, 'unreached'>;
}

export interface Segments {
  /** Disjoint, in address order. */
  readonly concrete: readonly Segment[];
  /** Disjoint, in address order: dead spans and holes. */
  readonly notes: readonly NoteSpan[];
  /** The function extents past the header, merged, in address order: their other free bytes are 'unreached'. */
  readonly extents: readonly Span[];
}

const RANK: Readonly<Record<Segment['kind'], number>> = { code: 0, pool: 1, table: 2, padding: 3, data: 4 };

function clip(span: Span, rom: Rom): Span {
  return { start: Math.max(span.start, rom.base), end: Math.min(span.end, rom.end) };
}

/** Spans merged where they overlap or touch, in address order. */
function merged(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .sort((a, b) => compareNumbers(a.start, b.start) || compareNumbers(a.end, b.end));
  const out: { start: Addr; end: Addr }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** A padding claim: the zeros from its start up to the next word boundary are padding, the rest data. */
function paddingSegments(rom: Rom, span: Span): Segment[] {
  const boundary = Math.min(alignWord(span.start), span.end);
  let zeros = boundary > span.start && boundary % 4 === 0;
  for (let a = span.start; zeros && a < boundary; a++) zeros = rom.bytes[a - rom.base] === 0;
  if (!zeros) return [{ kind: 'data', start: span.start, end: span.end }];
  return [
    { kind: 'padding', start: span.start, end: boundary },
    ...(boundary < span.end ? [{ kind: 'data' as const, start: boundary, end: span.end }] : []),
  ];
}

/** What the analysis says each byte is. */
export function segmentsOf(
  rom: Rom,
  analysis: Pick<AnalysisResult, 'functions' | 'claims'>,
  headerEnd: Addr,
): Segments {
  const raw: Segment[] = [];
  for (const mode of ['thumb', 'arm'] as const) {
    const spans = analysis.functions.filter((f) => f.mode === mode).flatMap((f) => f.code.map((s) => clip(s, rom)));
    for (const s of merged(spans)) raw.push({ kind: 'code', start: s.start, end: s.end, mode });
  }
  for (const f of analysis.functions) {
    for (const a of [...f.pools, ...f.farPools])
      if (contains(rom, a, 4)) raw.push({ kind: 'pool', start: a, end: a + 4, value: u32(rom, a) });
    for (const t of f.tables) {
      t.targets.forEach((target, i) => {
        const a = t.base + 4 * i;
        if (!contains(rom, a, 4)) return;
        const value = u32(rom, a);
        // The entry is the target the analysis read, with or without the Thumb bit; anything else is data.
        if ((value & ~1) >>> 0 === target)
          raw.push({ kind: 'table', start: a, end: a + 4, target, thumbBit: (value & 1) === 1, first: i === 0 });
        else raw.push({ kind: 'data', start: a, end: a + 4 });
      });
    }
  }
  for (const c of analysis.claims) {
    const span = clip(c.span, rom);
    if (span.end <= span.start) continue;
    if (c.kind === Claim.padding) pushAll(raw, paddingSegments(rom, span));
    else if (c.kind === Claim.data) raw.push({ kind: 'data', start: span.start, end: span.end });
  }
  raw.sort(
    (a, b) =>
      compareNumbers(a.start, b.start) || compareNumbers(RANK[a.kind], RANK[b.kind]) || compareNumbers(b.end, a.end),
  );

  const concrete: Segment[] = [];
  let covered: Addr = rom.base;
  for (const s of raw) {
    if (s.end <= covered) continue;
    if (s.start < covered) {
      // A later fact overlapping an earlier one keeps only what is left of it, and only when it can be cut:
      // code from the next instruction boundary of its mode, data from the first free byte.
      if (s.kind === 'code') {
        const step = s.mode === 'thumb' ? 2 : 4;
        const start = s.start + Math.ceil((covered - s.start) / step) * step;
        if (start < s.end) concrete.push({ ...s, start });
      } else if (s.kind === 'data') {
        concrete.push({ ...s, start: covered });
      }
    } else {
      concrete.push(s);
    }
    covered = Math.max(covered, concrete[concrete.length - 1]?.end ?? covered);
  }

  const noteRaw = analysis.functions
    .flatMap((f) => [
      ...f.dead.map((s) => ({ ...clip(s, rom), note: 'dead' as const })),
      ...f.holes.map((s) => ({ ...clip(s, rom), note: 'mixer-hole' as const })),
    ])
    .filter((n) => n.end > n.start)
    .sort(
      (a, b) =>
        compareNumbers(a.start, b.start) || compareNumbers(a.note === 'dead' ? 0 : 1, b.note === 'dead' ? 0 : 1),
    );
  const notes: NoteSpan[] = [];
  let noted: Addr = rom.base;
  for (const n of noteRaw) {
    if (n.end <= noted) continue;
    notes.push({ start: Math.max(n.start, noted), end: n.end, note: n.note });
    noted = n.end;
  }
  const extents = merged(
    analysis.functions.map((f) => ({
      start: Math.max(f.extent.start, headerEnd),
      end: Math.min(f.extent.end, rom.end),
    })),
  );
  return { concrete, notes, extents };
}
