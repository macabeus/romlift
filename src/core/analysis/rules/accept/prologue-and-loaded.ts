// accept.prologue-and-loaded (the PoC's acceptable()): a valid candidate that opens with a word-aligned
// `push {.., lr}` and that an accepted function loads from its literal pool (a candidate of origin
// pool-pointer) is taken: two independent signs of a compiled function.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'accept.prologue-and-loaded',
    summary: 'a valid candidate with a prologue that accepted code loads as a pointer is a function',
    restsOn: 'agbcc opens every non-leaf function with push {.., lr} on a word boundary, and code takes a function address from a pool',
    recovers: 'callbacks and handlers that accepted code installs by pointer',
    reads: ['rom', 'candidates'],
    adds: ['function-set'],
  },
  kind: 'accept',
  reason: 'unanchored',
  holds(c, r, v) {
    if (v.originOf(c.proposedBy) !== 'pool-pointer' || !v.profile.idioms.isPrologue(v.rom, r.entry, 'thumb')) return undefined;
    return { cites: [r.entry, ...c.cites], note: 'prologue, loaded from a pool' };
  },
});
