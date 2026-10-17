// seed.veneer (the PoC's accept() worklist): the ARM code a function enters with `bx pc` (a Thumb to
// ARM veneer), every one, ascending, as ARM.
import { compareNumbers } from '../../../../foundation/util/sorted.ts';
import type { Proposal } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.veneer',
    summary: 'the ARM code after a Thumb bx pc is an ARM function',
    restsOn: 'bx pc on a word boundary switches to ARM at the next word; nothing else executes those bytes',
    recovers: 'ARM routines reached only through a Thumb veneer',
    reads: ['readings'],
    adds: ['candidates'],
    origin: 'veneer',
  },
  kind: 'queue',
  queue(f) {
    const out: Proposal[] = [];
    for (const a of [...f.veneers].sort(compareNumbers)) out.push({ entry: a, mode: 'arm', cites: [f.entry] });
    return out;
  },
});
