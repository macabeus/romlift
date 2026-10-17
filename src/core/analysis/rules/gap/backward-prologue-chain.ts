// gap.backward-prologue-chain (the PoC's backward chain of prologues): scanning words down from the gap's
// current end to max(cursor, end - prologueDistance), the first raw `push {.., lr}` that is not a
// function, is valid, and whose reading ends within fillSlack of `end`. One candidate per call: the
// driver accepts it, shrinks `end` to it and asks again, which restarts the window below it.
import { defineRule } from '../define-rule.ts';
import { fillsTo } from '../../walk/cursor.ts';

export default defineRule({
  meta: {
    id: 'gap.backward-prologue-chain',
    summary: 'the highest push {.., lr} below the gap end, within prologueDistance, that is valid and ends within fillSlack of the end',
    restsOn: 'agbcc opens every function that calls with push {.., lr}, and functions tile the ROM up to the next one',
    recovers: 'a run of unreferenced functions before an accepted one, taken from the back when the forward chain stopped at data',
    reads: ['rom', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'gap-scan',
  },
  kind: 'gap',
  propose(c, v) {
    const { rom, profile } = v;
    const end = c.end;
    const floor = Math.max(c.at, end - profile.gapScan.prologueDistance);
    for (let q = (end - 4) & ~3; q >= floor; q -= 4) {
      if (!profile.idioms.opensWithPushLr(rom, q) || v.isFunction(q) || !v.valid(q)) continue;
      if (fillsTo(v.read(q, 'thumb'), end, profile.gapScan.fillSlack)) return { entry: q, mode: 'thumb', proposedBy: 'gap.backward-prologue-chain', cites: [q, end] };
    }
    return undefined;
  },
});
