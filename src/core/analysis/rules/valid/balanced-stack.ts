// valid.balanced-stack (the PoC's whyInvalid() and popsCallersFrame()): no return or tail exit of the
// walk pops more than the function pushed. A reading that does is the tail of another function, a far
// jump target, or data.
import { popsCallersFrame } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.balanced-stack',
    summary: 'no return path pops more than the function pushed',
    restsOn: 'a compiled function returns with the stack it was entered with',
    recovers: 'entries in the middle of a function, after its push, and data decoded as code',
    reads: ['readings'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'pops-frame',
  intrinsic: true,
  check(r) {
    return popsCallersFrame(r) ? 'a return path pops more than it pushed' : undefined;
  },
});
