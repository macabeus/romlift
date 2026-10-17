// seed.call (the PoC's accept() worklist): every callee of an accepted function, in the reading's
// `calls` order (target, then mode, then site), with the mode the call enters it in. Callees of
// accepted code are trusted: the driver accepts them without asking the validity slot.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.call',
    summary: 'the targets of the calls of an accepted function are functions',
    restsOn: 'a bl (or a bx after mov lr, pc) that settles as a call enters a function',
    recovers: 'the call graph below every accepted function',
    reads: ['readings', 'bl-verdicts'],
    adds: ['candidates'],
    origin: 'call',
  },
  kind: 'queue',
  queue(f) {
    return f.calls.map((c) => ({ entry: c.target, mode: c.mode, proposedBy: 'seed.call', cites: [c.site] }));
  },
});
