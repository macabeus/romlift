// gap.end-anchor (the PoC's end-anchor loop): scanning words down from the gap's current end to
// max(cursor, end - backwardWindow, head end), the valid Thumb reading with at least gapScan.minInsns
// instructions whose code stays below `end` and which fills to `end` within fillSlack or is anchored at
// its end. A prologue wins; without prologues the highest wins. One candidate per call: the driver
// accepts it, shrinks `end` to it and asks again. A two-instruction load-and-jump stub whose code ends
// exactly at an accepted stub of the same shape is one more element of that veneer array: it counts
// despite minInsns, and its pool (after the array) does not have to fill the hole (D60 b).
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

export default defineRule({
  meta: {
    id: 'gap.end-anchor',
    summary:
      'the highest valid reading below the gap end that ends at it (fillSlack) or is anchored there, a prologue preferred, within backwardWindow; a load-and-jump stub that ends at an accepted stub of the same shape counts below minInsns',
    restsOn:
      'functions tile the ROM, so the code just before an accepted function ends exactly where it starts; a veneer array is a run of two-instruction `ldr rN, [pc, #k]; bx rN` stubs laid end to end, so a stub ending exactly at the next stub of the array is code',
    recovers: 'unreferenced functions at the end of a gap that the forward chain cannot reach past data, and the unreferenced head of a veneer array that follows data',
    reads: ['rom', 'claims', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'gap-scan',
  },
  kind: 'gap',
  propose(c, v) {
    const { rom, profile } = v;
    const end = c.end;
    const floor = Math.max(c.at, end - profile.gapScan.backwardWindow, c.head?.end ?? c.at);
    let best: Addr | undefined;
    let bestPrologue = false;
    for (let q = (end - 4) & ~3; q >= floor; q -= 4) {
      if (v.isFunction(q) || v.claimAt(q) !== Claim.free || !contains(rom, q, 4) || u32(rom, q) === 0 || !v.valid(q)) continue;
      const r = v.read(q, 'thumb');
      if (!veneerArrayElement(r, end, v)) {
        if (r.insns.length < profile.gapScan.minInsns || r.codeEnd > end) continue;
        if (!fillsTo(r, end, profile.gapScan.fillSlack) && !anchoredAtEnd(r, v)) continue;
      }
      const prologue = profile.idioms.isPrologue(rom, q, 'thumb');
      if (best === undefined || (prologue && !bestPrologue)) {
        best = q;
        bestPrologue = prologue;
      } else if (!prologue && !bestPrologue) break;
    }
    return best === undefined ? undefined : { entry: best, mode: 'thumb', cites: [best, end] };
  },
});
