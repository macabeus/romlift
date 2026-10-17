// fillGaps() (the PoC's fillGaps), ported for control flow (D48): `hi` once per call; per free run (gap):
// absorb at the gap start, the gap's head once, the forward chain (absorb at every position, the
// Thumb/ARM pair compared at the same cursor, then the tiled hole, then the padding and pointer-word
// step), the end-anchor loop shrinking `end`, the late head acceptance, and the backward chain of
// prologues. The head is accepted only through the proposers after the pair (gap.tiled-hole-inner), at the
// gap's start and again after the end-anchor loop; the patient pass skips a whole gap whose head none of
// them accepts yet. Offsets below are ROM offsets, as in the PoC; the cursors the rules see carry bus
// addresses.
import { contains, HEADER_END, u16 } from '../../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import type { Candidate, GapCursor, Reading } from '../types.ts';
import { absorb, accept } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { extentEndOf } from './facts.ts';
import { peek, read, settle } from './settle.ts';
import type { DriverState } from './state.ts';
import { emit } from './trail.ts';

interface Gap {
  readonly start: number;
  /** The gap's end; the end-anchor and backward loops shrink `end`, never this. */
  readonly stop: number;
  readonly pass: 'patient' | 'impatient';
}

function align4(offset: number): number {
  return (offset + 3) & ~3;
}

function cursor(s: DriverState, g: Gap, p: number, end: number, head?: Reading): GapCursor {
  const B = s.rom.base;
  const span: Span = { start: B + g.start, end: B + g.stop };
  return { gap: span, at: B + p, end: B + end, ...(head === undefined ? {} : { head }), pass: g.pass };
}

function claimed(s: DriverState, offset: number): boolean {
  return (s.claims[offset] ?? 0) !== 0;
}

/** The PoC's absorbBlock(p, start, end): the block's end offset, or null. */
function absorbBlock(s: DriverState, g: Gap, p: number, end: number): number | null {
  const m = s.rules.gap.absorb?.rule.absorb(cursor(s, g, p, end), s.view);
  if (m === undefined) return null;
  const block = peek(s, m.span.start, 'thumb') ?? settle(s, m.span.start);
  absorb(s, m.into, block);
  return m.span.end - s.rom.base;
}

/** The PoC's absorbRun(p, start, end): consecutive blocks from p; where the regular scan resumes. */
function absorbRun(s: DriverState, g: Gap, from: number, end: number): number {
  let p = from;
  for (;;) {
    let q = p;
    if (claimed(s, q) && !claimed(s, q + 2)) q += 2; // a block at a halfword boundary
    let next = absorbBlock(s, g, q, end);
    if (next === null && contains(s.rom, s.rom.base + q, 2) && u16(s.rom, s.rom.base + q) === 0 && !claimed(s, q + 2)) next = absorbBlock(s, g, q + 2, end);
    if (next === null) return p;
    p = next;
  }
}

/** The PoC's holeHead(entry, hi). */
function holeHead(s: DriverState, g: Gap, p: number, end: number): Reading | null {
  return s.rules.gap.head?.rule.head(cursor(s, g, p, end), s.view) ?? null;
}

/** One forward proposer's candidate and its reading, after the accept vetoes. */
function proposal(s: DriverState, index: number, c: GapCursor): { readonly c: Candidate; readonly r: Reading } | null {
  const slot = s.rules.gap.forward[index];
  const proposed = slot?.rule.propose(c, s.view);
  if (slot === undefined || proposed === undefined) return null;
  const found: Candidate = { ...proposed, proposedBy: slot.id };
  const r = peek(s, found.entry, found.mode) ?? read(s, found.entry, found.mode);
  for (const { id, rule: veto } of s.rules.veto) {
    const why = veto.vetoes(found, r, s.view);
    if (why !== undefined) {
      emit(s, 'reject', found.entry, id, found.cites, why);
      return null;
    }
  }
  return { c: found, r };
}

/** The forward pair at one cursor: forward[0] (thumbCandidate) and forward[1] (armAhead). */
function pair(s: DriverState, g: Gap, p: number, end: number): { readonly thumb: ReturnType<typeof proposal>; readonly arm: ReturnType<typeof proposal> } {
  const c = cursor(s, g, p, end);
  return { thumb: proposal(s, 0, c), arm: proposal(s, 1, c) };
}

/** The first proposer after the pair that takes `head`, the hole head at `p` (the PoC's tryTiledHole and the head acceptance of fillGaps). */
function tiledAt(s: DriverState, g: Gap, p: number, end: number, head: Reading): Candidate | undefined {
  for (let i = 2; i < s.rules.gap.forward.length; i++) {
    const found = proposal(s, i, cursor(s, g, p, end, head));
    if (found !== null) return found.c;
  }
  return undefined;
}

/**
 * Accepts the gap's head that `taken` (a proposer after the pair) takes: proposed by the head rule, as the
 * PoC's fillGaps accepts it, with a second 'accept' event under the proposer that decided (D58 a).
 */
function acceptHead(s: DriverState, head: Reading, taken: Candidate): number {
  const id = s.rules.gap.head?.id ?? taken.proposedBy;
  const n = accept(s, { entry: head.entry, mode: head.mode, proposedBy: id, cites: [head.entry] });
  if (n > 0 && taken.proposedBy !== id) emit(s, 'accept', head.entry, taken.proposedBy, taken.cites, `takes the ${id} head`);
  return n;
}

/** The PoC's tryTiledHole(entry, hi): the hole head at the cursor, when a proposer after the pair takes it (accepted). */
function tiledHole(s: DriverState, g: Gap, p: number, end: number): Reading | null {
  if (s.rules.gap.forward.slice(2).every((slot) => slot === undefined)) return null;
  const head = holeHead(s, g, p, end);
  if (head === null) return null;
  const found = tiledAt(s, g, p, end, head);
  if (found === undefined) return null;
  accept(s, found);
  return head;
}

/** The prefer slot's choice between the Thumb and the ARM reading at one cursor ('thumb' without the slot), cited as a verdict. */
function preferred(s: DriverState, thumb: Reading, arm: Reading): 'thumb' | 'arm' {
  const slot = s.rules.gap.prefer;
  if (slot === undefined) return 'thumb';
  const choice = slot.rule.prefer(thumb, arm, s.view);
  emit(s, 'verdict', choice === 'thumb' ? thumb.entry : arm.entry, slot.id, [thumb.entry, arm.entry], `${choice} over ${choice === 'thumb' ? 'arm' : 'thumb'}`);
  return choice;
}

/** The skip slot's next cursor when nothing starts at `p`, cited as a verdict; undefined stops the chain. */
function skip(s: DriverState, g: Gap, p: number, end: number): Addr | undefined {
  const slot = s.rules.gap.skip;
  const next = slot?.rule.skip(cursor(s, g, p, end), s.view);
  if (slot !== undefined && next !== undefined) emit(s, 'verdict', s.rom.base + p, slot.id, [s.rom.base + p, next], `skips to ${hexAddr(next)}`);
  return next;
}

/** One proposal of the end-anchor or backward loop; only a candidate below the current end shrinks it. */
function shrink(s: DriverState, slot: 'endAnchor' | 'backward', g: Gap, p: number, end: number, head: Reading | null): Candidate | undefined {
  const rule = s.rules.gap[slot];
  const found = rule?.rule.propose(cursor(s, g, p, end, head ?? undefined), s.view);
  return rule !== undefined && found !== undefined && found.entry - s.rom.base < end ? { ...found, proposedBy: rule.id } : undefined;
}

/** The PoC's fillGaps(patient): accepts unreferenced functions between claimed runs; returns how many. */
export function fillGaps(s: DriverState, pass: 'patient' | 'impatient'): number {
  s.round += 1;
  beginEpoch(s);
  const B = s.rom.base;
  const entries = sortedKeys(s.funcs);
  if (entries.length === 0) return 0;
  let added = 0;
  let a = (entries[0] ?? B) - B;
  let hi = 0;
  for (const e of entries) {
    const f = s.funcs.get(e);
    if (f !== undefined) hi = Math.max(hi, extentEndOf(s, f.reading) - B);
  }
  while (a < hi) {
    if (claimed(s, a)) {
      a++;
      continue;
    }
    const start = a;
    while (a < hi && !claimed(s, a)) a++;
    const g: Gap = { start, stop: a, pass };
    let end = a;
    let p = align4(absorbRun(s, g, start, end)); // handler blocks of the function before the gap
    const head = holeHead(s, g, p, end);
    if (head !== null) {
      const taken = tiledAt(s, g, p, end, head);
      if (taken !== undefined) {
        added += acceptHead(s, head, taken);
        p = align4(head.end - B);
      } else if (pass === 'patient') {
        if (s.rules.gap.head !== undefined) emit(s, 'wait', head.entry, s.rules.gap.head.id, [head.entry, head.end], 'no proposer takes it yet: its end is not anchored');
        continue;
      }
    }
    while (p + 2 <= end) {
      if (claimed(s, p)) {
        p += 4; // a pool claimed by an earlier acceptance
        continue;
      }
      if (p < HEADER_END) {
        p = HEADER_END;
        continue;
      }
      const resumed = absorbRun(s, g, p, end);
      if (resumed !== p) {
        p = align4(resumed);
        continue;
      }
      const { thumb, arm } = pair(s, g, p, end);
      if (thumb !== null && (arm === null || preferred(s, thumb.r, arm.r) === 'thumb')) {
        added += accept(s, thumb.c);
        p = align4(thumb.r.end - B);
        continue;
      }
      if (arm !== null) {
        added += accept(s, arm.c);
        p = align4(arm.r.end - B);
        continue;
      }
      const tiled = tiledHole(s, g, p, end);
      if (tiled !== null) {
        added += 1;
        p = align4(tiled.end - B);
        continue;
      }
      const next = skip(s, g, p, end);
      if (next === undefined || next - B <= p) break;
      p = next - B;
    }
    // A valid candidate that ends where the next function starts tiles the hole.
    for (let found = shrink(s, 'endAnchor', g, p, end, head); found !== undefined; found = shrink(s, 'endAnchor', g, p, end, head)) {
      added += accept(s, found);
      end = found.entry - B;
    }
    if (head !== null && !s.funcs.has(head.entry) && !claimed(s, head.entry - B)) {
      const late = tiledAt(s, g, head.entry - B, end, head);
      if (late !== undefined) added += acceptHead(s, head, late);
    }
    for (let found = shrink(s, 'backward', g, p, end, null); found !== undefined; found = shrink(s, 'backward', g, p, end, null)) {
      added += accept(s, found);
      end = found.entry - B;
    }
  }
  return added;
}
