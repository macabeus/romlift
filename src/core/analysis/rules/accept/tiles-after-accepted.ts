// accept.tiles-after-accepted (the PoC's acceptable() and anchoredAtStart()): a valid candidate whose
// entry follows claimed bytes, give or take anchorSlack bytes of padding, continues the dense tiling
// of compiled code and is taken on that alone.
import { anchoredAtStart } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'accept.tiles-after-accepted',
    summary: 'a valid candidate that starts where claimed bytes end, give or take padding, is a function',
    restsOn: 'the linker lays compiled functions out back to back, each aligned with zero or nop padding',
    recovers: 'functions referenced only by pointers whose neighbour below is already known',
    reads: ['claims', 'rom'],
    adds: ['function-set'],
  },
  kind: 'accept',
  reason: 'unanchored',
  holds(c, r, v) {
    if (!anchoredAtStart(r.entry, v)) return undefined;
    return { cites: [r.entry, ...c.cites], note: 'anchored at start' };
  },
});
