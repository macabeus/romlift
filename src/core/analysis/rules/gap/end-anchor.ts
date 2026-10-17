// gap.end-anchor (the PoC's end-anchor loop): scanning words down from the gap's current end to
// max(cursor, end - backwardWindow, head end), the valid Thumb reading with at least gapScan.minInsns
// instructions whose code stays below `end` and which fills to `end` within fillSlack or is anchored at
// its end. A prologue wins; without prologues the highest wins. One candidate per call: the driver
// accepts it, shrinks `end` to it and asks again.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { Claim } from '../../types.ts';
import { anchoredAtEnd, fillsTo } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.end-anchor',
    summary: 'the highest valid reading below the gap end that ends at it (fillSlack) or is anchored there, a prologue preferred, within backwardWindow',
    restsOn: 'functions tile the ROM, so the code just before an accepted function ends exactly where it starts',
    recovers: 'unreferenced functions at the end of a gap that the forward chain cannot reach past data',
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
      if (r.insns.length < profile.gapScan.minInsns || r.codeEnd > end) continue;
      if (!fillsTo(r, end, profile.gapScan.fillSlack) && !anchoredAtEnd(r, v)) continue;
      const prologue = profile.idioms.isPrologue(rom, q, 'thumb');
      if (best === undefined || (prologue && !bestPrologue)) {
        best = q;
        bestPrologue = prologue;
      } else if (!prologue && !bestPrologue) break;
    }
    return best === undefined ? undefined : { entry: best, mode: 'thumb', proposedBy: 'gap.end-anchor', cites: [best, end] };
  },
});
