// gap.end-anchor (the PoC's end-anchor loop): scanning words down from the gap's current end to
// max(cursor, end - backwardWindow, head end), the valid Thumb reading with at least gapScan.minInsns
// instructions whose code stays below `end` and which fills to `end` within fillSlack or is anchored at
// its end. A prologue wins; without prologues the highest wins. One candidate per call: the driver
// accepts it, shrinks `end` to it and asks again. A two-instruction load-and-jump stub whose code ends
// exactly at an accepted stub of the same shape is one more element of that veneer array: it counts
// despite minInsns, and its pool (after the array) does not have to fill the hole (D60 b). Where the
// profile lets Thumb functions sit on 2 mod 4, the halfword between two words is a candidate too when it
// opens with `push {.., lr}`, ranked as a prologue with the word candidates by the same rule (D60 c).
import { decode, thumbWordAt } from '../../../../foundation/isa/decode.ts';
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import type { AnalysisView, Reading } from '../../types.ts';
import { Claim } from '../../types.ts';
import { anchoredAtEnd, fillsTo } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

/** The Thumb reading is exactly `ldr rN, [pc, #k]; bx rN`: a load-and-jump veneer. */
function isLoadJumpStub(r: Reading, v: AnalysisView): boolean {
  if (r.mode !== 'thumb' || r.insns.length !== 2 || !contains(v.rom, r.entry, 4)) return false;
  const load = decode('thumb', thumbWordAt(v.rom, r.entry), r.entry).flow;
  const jump = decode('thumb', thumbWordAt(v.rom, r.entry + 2), r.entry + 2).flow;
  return load.kind === 'pool-load' && jump.kind === 'indirect' && jump.via === 'bx' && jump.reg === load.rd;
}

/** `r` is a load-and-jump stub whose code ends exactly at `end`, where an accepted stub of the same shape starts: an element of a veneer array. */
function veneerArrayElement(r: Reading, end: Addr, v: AnalysisView): boolean {
  if (r.codeEnd !== end || !v.isFunction(end) || !isLoadJumpStub(r, v)) return false;
  return isLoadJumpStub(v.accepted(end) ?? v.read(end, 'thumb'), v);
}

/**
 * A valid Thumb reading at `h`, on the halfword between two words, that opens with `push {.., lr}` and
 * otherwise qualifies as a word-aligned candidate does (minInsns, code below `end`, filling the hole or
 * anchored at its end): a hand-written function that sits on 2 mod 4. It ranks as a prologue.
 */
function pushesLrBetweenWords(h: Addr, end: Addr, v: AnalysisView): boolean {
  const { profile } = v;
  if (v.isFunction(h) || v.claimAt(h) !== Claim.free || !profile.idioms.opensWithPushLr(v.rom, h) || !v.valid(h)) return false;
  const r = v.read(h, 'thumb');
  if (r.insns.length < profile.gapScan.minInsns || r.codeEnd > end) return false;
  return fillsTo(r, end, profile.gapScan.fillSlack) || anchoredAtEnd(r, v);
}

export default defineRule({
  meta: {
    id: 'gap.end-anchor',
    summary:
      'the highest valid reading below the gap end that ends at it (fillSlack) or is anchored there, a prologue (or `push {.., lr}` on 2 mod 4) preferred, within backwardWindow; a load-and-jump stub that ends at an accepted stub of the same shape counts below minInsns',
    restsOn:
      'functions tile the ROM, so the code just before an accepted function ends exactly where it starts; a veneer array is a run of two-instruction `ldr rN, [pc, #k]; bx rN` stubs laid end to end, so a stub ending exactly at the next stub of the array is code; hand-written Thumb may start on 2 mod 4, where `push {.., lr}` opens it as it opens a compiled function on a word',
    recovers: 'unreferenced functions at the end of a gap that the forward chain cannot reach past data (hand-written ones on 2 mod 4 too), and the unreferenced head of a veneer array that follows data',
    reads: ['rom', 'claims', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'gap-scan',
  },
  kind: 'gap',
  propose(c, v) {
    const { rom, profile } = v;
    const end = c.end;
    const floor = Math.max(c.at, end - profile.gapScan.backwardWindow, c.head?.end ?? c.at);
    // Hand-written Thumb may start on the halfword between two words (alignment.thumbFunction).
    const halfwords = profile.alignment.thumbFunction < 4;
    let best: Addr | undefined;
    let bestPrologue = false;
    // The candidates at one word, highest first: the halfword after it (a `push {.., lr}` on 2 mod 4,
    // ranked as a prologue) and the word itself. Both go through the one ranking: a prologue wins, and
    // without prologues the highest wins, so the scan stops at the first lower reading without one.
    const word = (q: Addr): boolean | undefined => {
      if (v.isFunction(q) || v.claimAt(q) !== Claim.free || !contains(rom, q, 4) || u32(rom, q) === 0 || !v.valid(q)) return undefined;
      const r = v.read(q, 'thumb');
      if (!veneerArrayElement(r, end, v)) {
        if (r.insns.length < profile.gapScan.minInsns || r.codeEnd > end) return undefined;
        if (!fillsTo(r, end, profile.gapScan.fillSlack) && !anchoredAtEnd(r, v)) return undefined;
      }
      return profile.idioms.isPrologue(rom, q, 'thumb');
    };
    scan: for (let q = (end - 4) & ~3; q >= floor; q -= 4) {
      const candidates: (readonly [Addr, boolean])[] = [];
      if (halfwords && q + 2 >= floor && q + 4 <= end && pushesLrBetweenWords(q + 2, end, v)) candidates.push([q + 2, true]);
      const prologue = word(q);
      if (prologue !== undefined) candidates.push([q, prologue]);
      for (const [at, isPrologue] of candidates) {
        if (best === undefined || (isPrologue && !bestPrologue)) {
          best = at;
          bestPrologue = isPrologue;
        } else if (!isPrologue && !bestPrologue) break scan;
      }
    }
    return best === undefined ? undefined : { entry: best, mode: 'thumb', cites: [best, end] };
  },
});
