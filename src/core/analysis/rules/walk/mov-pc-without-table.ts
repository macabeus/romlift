// walk.mov-pc-without-table: a computed jump that no table rule explained ends the path as a register
// jump, counted as an exit (the PoC's `mov_pc` branch of analyzeThumb with no table target, and the
// `pc_write` branch of analyzeArm: `mov`/`add pc`, `ldr pc, [rN]`, `ldm rN, {.., pc}`). `bx rN` is
// not this rule's: the decoder's Flow already ends it as a register jump, and walk.mov-lr-pc-bx-is-call
// may make it a call. Without this rule such a jump is not code (D56). In ARM a conditional jump counts
// the exit and the path goes on, as the PoC's `if (always) break`.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.mov-pc-without-table',
    summary: 'a write to pc that is not a table jump or bx ends the path as a register jump',
    restsOn:
      'compiled and hand-written code jump through registers (function pointers, switch helpers, ARM handlers); the target is unknown, not invalid',
    recovers: 'functions ending in a computed jump, which would otherwise read as not code',
    reads: ['rom'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.phase !== 'insn' || insn.flow.kind !== 'indirect' || insn.flow.via === 'bx') return undefined;
    return { step: 'end-path', exit: 'reg-jump' };
  },
});
