// walk.mov-lr-pc-bx-is-call: in ARM, a `bx rN` right after `mov lr, pc` is an indirect call, not an
// exit (the PoC's `bx` branch of analyzeArm: `!(kind === 'bx' && prev === MOV_LR_PC)`). The return
// address is the instruction after the bx, so the path goes on. Only the exact unconditional encoding of
// `mov lr, pc` counts, and only a bx of the exact `bx` encoding (the PoC's mask; any register, lr
// included), and only when it is the previous instruction of the same straight-line run.
import { defineRule } from '../define-rule.ts';

/** The encoding of ARM `mov lr, pc` (condition AL), as the PoC compares it. */
const MOV_LR_PC = 0xe1a0e00f;

export default defineRule({
  meta: {
    id: 'walk.mov-lr-pc-bx-is-call',
    summary: 'ARM `mov lr, pc` then `bx rN` is a call through a register: the path goes on after the bx',
    restsOn:
      'ARMv4T has no blx; hand-written ARM and interworking code call through a register with `mov lr, pc; bx rN`',
    recovers: 'the code after an indirect call, which an exit at the bx would leave unreached',
    reads: ['rom', 'readings'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'arm' || cursor.phase !== 'insn' || insn.specId !== 'arm.bx') return undefined;
    const prev = cursor.back(1);
    return prev !== undefined && prev.word >>> 0 === MOV_LR_PC ? { step: 'continue' } : undefined;
  },
});
