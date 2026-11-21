// bl.target-before-entry: a bl to an address below the caller's entry is a call (the PoC's settle()
// ladder: `target < entry`). A far jump is how agbcc continues a function beyond the reach of `b`; that
// continuation always lies after the code it continues, so a backward bl names another function, found
// or not yet found. Asked after bl.self-or-accepted, so the target here is not yet known as a function;
// asked before bl.near-is-call, so even a far backward bl is a call. The comparison is strict: a bl to
// the entry itself is bl.self-or-accepted's.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.target-before-entry',
    summary: "a bl to an address below the caller's entry is a call",
    restsOn: 'agbcc uses bl as a jump only to reach the far tail of the same function, which lies after its entry',
    recovers: 'calls to functions not yet found that sit before the caller, misread as far jumps',
    reads: ['readings'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, caller) {
    return site.target < caller.entry ? 'call' : undefined;
  },
});
