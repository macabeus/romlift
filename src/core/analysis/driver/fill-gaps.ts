// fillGaps() (the PoC's fillGaps), ported for control flow (D48): `hi` once per call; per free run (gap):
// absorb at the gap start, the gap's head once, the forward chain (absorb at every position, the
// Thumb/ARM pair compared at the same cursor, then the tiled hole, then the padding and pointer-word
// step), the end-anchor loop shrinking `end`, the late head acceptance, and the backward chain of
// prologues. The head is accepted only through the proposers after the pair (gap.tiled-hole-inner),
// wherever it is taken (the gap start, a forward-chain cursor, after the end-anchor loop), and always under
// the head rule; the patient pass skips a whole gap whose head none of them accepts yet. Every position
// here is a bus address, as in the cursors the rules see. fillGaps returns the functions it added: the sum
// of what accept() reports, absorbed blocks' calls included, so a confirm run whose candidates are all
// unlisted reaches its fixpoint.
import { HEADER_END } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import type { Candidate, GapCursor, GapProposer, Reading } from '../types.ts';
import { absorb, accept } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { extentEndOf } from './facts.ts';
import type { Resolved } from './rules.ts';
import { peek, read, settle } from './settle.ts';
import type { DriverState } from './state.ts';
import { emit, reject } from './trail.ts';

interface Gap {
  readonly start: Addr;
  /** The gap's end; the end-anchor and backward loops shrink `end`, never this. */
  readonly stop: Addr;
  readonly pass: 'patient' | 'impatient';
}

/** One forward proposer's candidate and its reading, after the accept vetoes. */
interface Found {
  readonly c: Candidate;
  readonly r: Reading;
}

/** The count of one fillGaps call, shared by the helpers that accept. */
interface Added {
  n: number;
}

function align4(a: Addr): Addr {
  return (a + 3) & ~3;
}

function cursor(g: Gap, at: Addr, end: Addr, head?: Reading): GapCursor {
  return { gap: { start: g.start, end: g.stop }, at, end, ...(head === undefined ? {} : { head }), pass: g.pass };
}

function claimed(s: DriverState, a: Addr): boolean {
  return (s.claims[a - s.rom.base] ?? 0) !== 0;
}

/** The PoC's absorbBlock: the absorb slot's block at the cursor, merged; where it ends, or null. */
function absorbBlock(s: DriverState, g: Gap, at: Addr, end: Addr, added: Added): Addr | null {
  const m = s.rules.gap.absorb?.rule.absorb(cursor(g, at, end), s.view);
  if (m === undefined) return null;
  const block = peek(s, m.span.start, 'thumb') ?? settle(s, m.span.start);
  added.n += absorb(s, m.into, block);
  return m.span.end;
}

/** The PoC's absorbRun: consecutive blocks from `from`; where the regular scan resumes. */
function absorbRun(s: DriverState, g: Gap, from: Addr, end: Addr, added: Added): Addr {
  let p = from;
  for (let next = absorbBlock(s, g, p, end, added); next !== null; next = absorbBlock(s, g, p, end, added)) p = next;
  return p;
}

/** The PoC's holeHead(entry, hi). */
function holeHead(s: DriverState, g: Gap, at: Addr, end: Addr): Reading | null {
  return s.rules.gap.head?.rule.head(cursor(g, at, end), s.view) ?? null;
}

/** One forward proposer's candidate and its reading, unless an accept veto rejects it (recorded as a rejection under the veto). */
function proposal(s: DriverState, slot: Resolved<GapProposer> | undefined, c: GapCursor): Found | null {
  const proposed = slot?.rule.propose(c, s.view);
  if (slot === undefined || proposed === undefined) return null;
  const found: Candidate = { ...proposed, proposedBy: slot.id };
  const r = peek(s, found.entry, found.mode) ?? read(s, found.entry, found.mode);
  for (const { id, rule: veto } of s.rules.veto) {
    const why = veto.vetoes(found, r, s.view);
    if (why !== undefined) {
      reject(s, found.entry, found.mode, id, veto.reason, false, `proposed by ${found.proposedBy}: ${why}`, found.cites);
      return null;
    }
  }
  return { c: found, r };
}

/** The forward pair at one cursor: the Thumb proposer (thumbCandidate) and the ARM one (armAhead). */
function pair(s: DriverState, g: Gap, at: Addr, end: Addr): { readonly thumb: Found | null; readonly arm: Found | null } {
  const c = cursor(g, at, end);
  return { thumb: proposal(s, s.rules.gap.forward.thumb, c), arm: proposal(s, s.rules.gap.forward.arm, c) };
}

/** The first proposer after the pair that takes `head`, the hole head at `at` (the PoC's tryTiledHole and the head acceptance of fillGaps). */
function tiledAt(s: DriverState, g: Gap, at: Addr, end: Addr, head: Reading): Candidate | undefined {
  for (const slot of s.rules.gap.forward.after) {
    const found = proposal(s, slot, cursor(g, at, end, head));
    if (found !== null) return found.c;
  }
  return undefined;
}

/**
 * Accepts the hole head that `taken` (a proposer after the pair) takes: proposed by the head rule, as the
 * PoC's fillGaps and tryTiledHole both accept it ('tiled hole'), with a second 'accept' event under the
 * proposer that decided (D58 a). Returns what accept() added.
 */
function acceptHead(s: DriverState, head: Reading, taken: Candidate): number {
  const id = s.rules.gap.head?.id ?? taken.proposedBy;
  const n = accept(s, { entry: head.entry, mode: head.mode, proposedBy: id, cites: [head.entry] });
  if (n > 0 && taken.proposedBy !== id) emit(s, 'accept', head.entry, taken.proposedBy, taken.cites, `takes the ${id} head`);
  return n;
}

/** The prefer slot's choice between the Thumb and the ARM reading at one cursor ('thumb' without the slot), cited as a verdict. */
function preferred(s: DriverState, thumb: Reading, arm: Reading): 'thumb' | 'arm' {
  const slot = s.rules.gap.prefer;
  if (slot === undefined) return 'thumb';
  const choice = slot.rule.prefer(thumb, arm, s.view);
  emit(s, 'verdict', choice === 'thumb' ? thumb.entry : arm.entry, slot.id, [thumb.entry, arm.entry], `${choice} over ${choice === 'thumb' ? 'arm' : 'thumb'}`);
  return choice;
}

/** The skip slot's next cursor when nothing starts at `at`, cited as a verdict; undefined stops the chain. */
function skip(s: DriverState, g: Gap, at: Addr, end: Addr): Addr | undefined {
  const slot = s.rules.gap.skip;
  const next = slot?.rule.skip(cursor(g, at, end), s.view);
  if (slot !== undefined && next !== undefined) emit(s, 'verdict', at, slot.id, [at, next], `skips to ${hexAddr(next)}`);
  return next;
}

/** One proposal of the end-anchor or backward loop; only a candidate below the current end shrinks it. */
function shrink(s: DriverState, slot: 'endAnchor' | 'backward', g: Gap, at: Addr, end: Addr, head: Reading | null): Candidate | undefined {
  const rule = s.rules.gap[slot];
  const found = rule?.rule.propose(cursor(g, at, end, head ?? undefined), s.view);
  return rule !== undefined && found !== undefined && found.entry < end ? { ...found, proposedBy: rule.id } : undefined;
}

/** The forward chain from `from` towards `end`; where it stopped. */
function forwardChain(s: DriverState, g: Gap, from: Addr, end: Addr, added: Added): Addr {
  const headerEnd = s.rom.base + HEADER_END;
  let p = from;
  while (p + 2 <= end) {
    // Traversal, not a decision: a pool that a claim rule claimed when an earlier acceptance was made.
    if (claimed(s, p)) {
      p += 4;
      continue;
    }
    // The cartridge header is format, not code: the chain never stands in it (Review, architecture-r1-4).
    if (p < headerEnd) {
      p = headerEnd;
      continue;
    }
    const resumed = absorbRun(s, g, p, end, added);
    if (resumed !== p) {
      p = align4(resumed);
      continue;
    }
    const { thumb, arm } = pair(s, g, p, end);
    if (thumb !== null && (arm === null || preferred(s, thumb.r, arm.r) === 'thumb')) {
      added.n += accept(s, thumb.c);
      p = align4(thumb.r.end);
      continue;
    }
    if (arm !== null) {
      added.n += accept(s, arm.c);
      p = align4(arm.r.end);
      continue;
    }
    // The PoC's tryTiledHole: the hole head at the cursor, when a proposer after the pair takes it.
    const head = s.rules.gap.forward.after.length === 0 ? null : holeHead(s, g, p, end);
    const taken = head === null ? undefined : tiledAt(s, g, p, end, head);
    if (head !== null && taken !== undefined) {
      added.n += acceptHead(s, head, taken);
      p = align4(head.end);
      continue;
    }
    const next = skip(s, g, p, end);
    if (next === undefined || next <= p) break;
    p = next;
  }
  return p;
}

/** One gap: the head, the forward chain, the end-anchor loop, the late head and the backward chain. */
function fillGap(s: DriverState, g: Gap, added: Added): void {
  let end = g.stop;
  let p = align4(absorbRun(s, g, g.start, end, added)); // handler blocks of the function before the gap
  const head = holeHead(s, g, p, end);
  if (head !== null) {
    const taken = tiledAt(s, g, p, end, head);
    if (taken !== undefined) {
      added.n += acceptHead(s, head, taken);
      p = align4(head.end);
    } else if (g.pass === 'patient') {
      if (s.rules.gap.head !== undefined) emit(s, 'wait', head.entry, s.rules.gap.head.id, [head.entry, head.end], 'no proposer takes it yet: its end is not anchored');
      return;
    }
  }
  p = forwardChain(s, g, p, end, added);
  // A valid candidate that ends where the next function starts tiles the hole.
  for (let found = shrink(s, 'endAnchor', g, p, end, head); found !== undefined; found = shrink(s, 'endAnchor', g, p, end, head)) {
    added.n += accept(s, found);
    end = found.entry;
  }
  if (head !== null && !s.funcs.has(head.entry) && !claimed(s, head.entry)) {
    const late = tiledAt(s, g, head.entry, end, head);
    if (late !== undefined) added.n += acceptHead(s, head, late);
  }
  for (let found = shrink(s, 'backward', g, p, end, null); found !== undefined; found = shrink(s, 'backward', g, p, end, null)) {
    added.n += accept(s, found);
    end = found.entry;
  }
}

/** The PoC's fillGaps(patient): accepts unreferenced functions between claimed runs; returns how many it added. */
export function fillGaps(s: DriverState, pass: 'patient' | 'impatient'): number {
  s.round += 1;
  beginEpoch(s);
  const entries = sortedKeys(s.funcs);
  const first = entries[0];
  if (first === undefined) return 0;
  const added: Added = { n: 0 };
  let hi: Addr = s.rom.base;
  for (const e of entries) {
    const f = s.funcs.get(e);
    if (f !== undefined) hi = Math.max(hi, extentEndOf(s, f.reading));
  }
  for (let a = first; a < hi; ) {
    if (claimed(s, a)) {
      a++;
      continue;
    }
    const start = a;
    while (a < hi && !claimed(s, a)) a++;
    fillGap(s, { start, stop: a, pass }, added);
  }
  return added.n;
}
