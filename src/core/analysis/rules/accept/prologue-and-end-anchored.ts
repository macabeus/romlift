// accept.prologue-and-end-anchored (the PoC's acceptable() and anchoredAtEnd()): a valid candidate that
// opens with a word-aligned `push {.., lr}` and whose extent ends where an accepted function starts,
// give or take anchorSlack bytes of padding, is taken.
import { provenance } from '../../../provenance/provenance.ts';
import { anchoredAtEnd } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'accept.prologue-and-end-anchored',
    summary: 'a valid candidate with a prologue whose extent ends at an accepted function is a function',
    restsOn: 'agbcc opens non-leaf functions with push {.., lr}, and the linker lays functions out back to back',
    recovers: 'data-referenced functions whose neighbour above is already known',
    reads: ['rom', 'readings', 'function-set', 'claims'],
    adds: ['function-set'],
  },
  kind: 'accept',
  reason: 'unanchored',
  holds(c, r, v) {
    if (!v.profile.idioms.isPrologue(v.rom, r.entry, 'thumb') || !anchoredAtEnd(r, v)) return undefined;
    return provenance('accept.prologue-and-end-anchored', v.round, [r.entry, r.end, ...c.cites], 'prologue, anchored at end');
  },
});
