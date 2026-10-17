// gap.tiled-hole-inner (the PoC's tryTiledHole inside the forward chain): when nothing else starts at the
// cursor, the head reading there (cursor.head, from gap.tiled-hole) is accepted when it fills the rest of
// the gap within fillSlack bytes or a function starts right after it.
import { anchoredAtEnd, fillsTo } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.tiled-hole-inner',
    summary: 'the hole head at a forward-chain cursor is accepted when it ends within fillSlack of the gap end or is anchored at its end',
    restsOn: 'compiled and hand-written code tiles the ROM: a reading that ends where the next function starts is that hole\'s function, dense or not',
    recovers: 'mixers and table-carrying functions in the middle of a gap, after the forward chain has taken the functions before them',
    reads: ['rom', 'claims', 'function-set', 'readings'],
    adds: ['candidates'],
    origin: 'tiled-hole',
  },
  kind: 'gap',
  propose(c, v) {
    const head = c.head;
    if (head === undefined) return undefined;
    if (!fillsTo(head, c.end, v.profile.gapScan.fillSlack) && !anchoredAtEnd(head, v)) return undefined;
    return { entry: head.entry, mode: 'thumb', proposedBy: 'gap.tiled-hole-inner', cites: [head.entry, head.end, c.end] };
  },
});
