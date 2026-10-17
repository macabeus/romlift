// bl.target-pops-unpushed-frame: the last clause of the PoC's settle() ladder. The target is settled as a
// Thumb function of its own (v.read, itself a settle); when one of its return or tail paths pops more
// than it pushed (popsCallersFrame), it is the tail of the caller that pushed the frame, so the bl is a
// far jump; otherwise it is a call. A target whose own bl verdicts are being settled up the stack is
// deferred (the PoC's `inProgress` → null), and settle() asks again in its next round.
import { popsCallersFrame } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.target-pops-unpushed-frame',
    summary: 'a bl whose target, read alone, pops a frame it never pushed is a far jump; otherwise a call',
    restsOn: 'the far tail of an agbcc function ends with the epilogue of the frame its head pushed, so read alone it pops more than it pushes',
    recovers: 'far tails without a prologue split off as functions, and calls to plain functions misread as jumps',
    reads: ['readings', 'function-set'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, _caller, v) {
    if (v.inProgress(site.target)) return 'defer';
    return popsCallersFrame(v.read(site.target, 'thumb')) ? 'far' : 'call';
  },
});
