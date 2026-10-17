// fillGaps() (the PoC's fillGaps), ported for control flow (D48): `hi` once per call; per free run (gap):
// absorb at the gap start, the gap's head once, the forward chain (absorb at every position, the
// Thumb/ARM pair compared at the same cursor, then the tiled hole, then the padding and pointer-word
// step), the end-anchor loop shrinking `end`, the late head acceptance, and the backward chain of
// prologues. The patient pass skips a whole gap whose head is not anchored yet. Offsets below are ROM
// offsets, as in the PoC; the cursors the rules see carry bus addresses.
import { contains, u16 } from '../../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../../foundation/rom/span.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { consult } from '../oracle.ts';
import type { OracleAnswer, OracleQuery } from '../oracle.ts';
import type { Candidate, GapCursor, Reading } from '../types.ts';
import { anchoredAtEnd, fillsTo } from '../walk/cursor.ts';
import { absorb, accept } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { peek, read, settle } from './settle.ts';
import { emit, extentEndOf } from './view.ts';
import type { DriverState } from './view.ts';

/** The cartridge header (0x00..0xBF) is never code. */
const HEADER_END = 0xc0;

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

/** Asks the oracle; when it answers, `apply` performs the PoC's side effects of that answer. */
function consultWith<M extends 'absorbBlock' | 'tryTiledHole'>(s: DriverState, query: OracleQuery<M>, compute: () => OracleAnswer<M>, apply: (a: OracleAnswer<M>) => void): OracleAnswer<M> {
  const oracle = s.tuning.oracle;
  const logged = oracle?.ask(query);
  if (logged !== undefined) {
    apply(logged);
    return logged;
  }
  const ours = compute();
  oracle?.check(query, ours);
  return ours;
}

/** The PoC's absorbBlock(p, start, end): the block's end offset, or null. */
function absorbBlock(s: DriverState, g: Gap, p: number, end: number): number | null {
  const B = s.rom.base;
  return consultWith(
    s,
    { method: 'absorbBlock', p, start: g.start, end },
    () => {
      const rule = s.rules.gap.absorb;
      const m = rule?.rule.absorb(cursor(s, g, p, end), s.view);
      if (m === undefined) return null;
      const block = peek(s, m.span.start, 'thumb') ?? settle(s, m.span.start);
      absorb(s, m.into, block);
      return m.span.end - B;
    },
    (answer) => {
      const into = s.adrOwner.get(B + p);
      if (answer !== null && into !== undefined) absorb(s, into, settle(s, B + p));
    },
  );
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
  return consult(s.tuning.oracle, { method: 'holeHead', entry: s.rom.base + p, hi: end }, () => s.rules.gap.head?.rule.head(cursor(s, g, p, end), s.view) ?? null);
}

/** One forward proposer's candidate and its reading, after the accept vetoes. */
function proposal(s: DriverState, index: number, c: GapCursor): { readonly c: Candidate; readonly r: Reading } | null {
  const rule = s.rules.gap.forward[index]?.rule;
  const found = rule?.propose(c, s.view);
  if (found === undefined) return null;
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

function forwardId(s: DriverState, index: number): RuleId {
  return s.profile.pipeline.gap.forward[index] ?? s.profile.pipeline.gap.head;
}

/** A candidate for an answer the oracle gave without one. */
function candidate(r: Reading, proposedBy: RuleId): Candidate {
  return { entry: r.entry, mode: r.mode, proposedBy, cites: [r.entry] };
}

/** The forward pair at one cursor: forward[0] (thumbCandidate) and forward[1] (armAhead). */
function pair(s: DriverState, g: Gap, p: number, end: number): { readonly thumb: Candidate | undefined; readonly thumbR: Reading | null; readonly arm: Candidate | undefined; readonly armR: Reading | null } {
  const B = s.rom.base;
  const c = cursor(s, g, p, end);
  let thumb: Candidate | undefined;
  const thumbR = consult(s.tuning.oracle, { method: 'thumbCandidate', entry: B + p, lo: g.start, hi: end }, () => {
    const found = proposal(s, 0, c);
    thumb = found?.c;
    return found?.r ?? null;
  });
  let arm: Candidate | undefined;
  const ahead = consult(s.tuning.oracle, { method: 'armAhead', p, end }, () => {
    const found = proposal(s, 1, c);
    arm = found?.c;
    return found === null ? null : { at: found.c.entry - B, reading: found.r };
  });
  return {
    thumb: thumbR === null ? undefined : (thumb ?? candidate(thumbR, forwardId(s, 0))),
    thumbR,
    arm: ahead === null ? undefined : (arm ?? candidate(ahead.reading, forwardId(s, 1))),
    armR: ahead?.reading ?? null,
  };
}

/** The PoC's tryTiledHole(entry, hi): the forward proposers after the pair, each seeing the head at the cursor; the first answer is accepted. */
function tiledHole(s: DriverState, g: Gap, p: number, end: number): Reading | null {
  const B = s.rom.base;
  return consultWith(
    s,
    { method: 'tryTiledHole', entry: B + p, hi: end },
    () => {
      let head: Reading | null | undefined;
      for (let i = 2; i < s.rules.gap.forward.length; i++) {
        if (s.rules.gap.forward[i] === undefined) continue;
        head ??= holeHead(s, g, p, end);
        if (head === null) return null;
        const found = proposal(s, i, cursor(s, g, p, end, head));
        if (found === null) continue;
        accept(s, found.c);
        return head;
      }
      return null;
    },
    (answer) => {
      if (answer !== null) accept(s, candidate(answer, forwardId(s, 2)));
    },
  );
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
  const found = s.rules.gap[slot]?.rule.propose(cursor(s, g, p, end, head ?? undefined), s.view);
  return found !== undefined && found.entry - s.rom.base < end ? found : undefined;
}

/** The PoC's fillGaps(patient): accepts unreferenced functions between claimed runs; returns how many. */
export function fillGaps(s: DriverState, pass: 'patient' | 'impatient'): number {
  s.round += 1;
  beginEpoch(s);
  const B = s.rom.base;
  const entries = sortedKeys(s.funcs);
  if (entries.length === 0) return 0;
  const slack = s.profile.gapScan.fillSlack;
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
      if (fillsTo(head, B + end, slack) || anchoredAtEnd(head, s.view)) {
        added += accept(s, candidate(head, s.profile.pipeline.gap.head));
        p = align4(head.end - B);
      } else if (pass === 'patient') {
        emit(s, 'wait', head.entry, s.profile.pipeline.gap.head, [head.entry, head.end], 'its end is not anchored yet');
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
      const { thumb, thumbR, arm, armR } = pair(s, g, p, end);
      if (thumb !== undefined && thumbR !== null && (armR === null || preferred(s, thumbR, armR) === 'thumb')) {
        added += accept(s, thumb);
        p = align4(thumbR.end - B);
        continue;
      }
      if (arm !== undefined && armR !== null) {
        added += accept(s, arm);
        p = align4(armR.end - B);
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
      if (fillsTo(head, B + end, slack) || anchoredAtEnd(head, s.view)) added += accept(s, candidate(head, s.profile.pipeline.gap.head));
    }
    for (let found = shrink(s, 'backward', g, p, end, null); found !== undefined; found = shrink(s, 'backward', g, p, end, null)) {
      added += accept(s, found);
      end = found.entry - B;
    }
  }
  return added;
}
