// walk.noreturn-call-before-noncode: when a Thumb path runs into non-code right after a `bl` (once the
// zero padding is dropped), the call never returns and the path ends without an error (the PoC's
// `if (last && last[1] === 'bl') f.deadEnd.add(last[0])` in analyzeThumb). The walker records the site
// in the reading's dead ends; settle() then gives that call the refinement bl.noreturn-before-noncode.
// Any other instruction before non-code leaves the path as a decode error.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.noreturn-call-before-noncode',
    summary: 'a bl followed by non-code is a call that never returns: the path ends there',
    restsOn:
      'agbcc emits nothing after a call to a function that never returns (abort, a reset loop), so the next bytes are a pool or the next function',
    recovers: 'functions ending in a never-returning call, which would otherwise read as not code',
    reads: ['rom'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'thumb' || cursor.phase !== 'stop' || insn.flow.kind !== 'bl') return undefined;
    return { step: 'end-path', exit: 'noreturn-call' };
  },
});
