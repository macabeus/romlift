// walk.trailing-zero-padding: when a Thumb path runs into non-code (an undecodable halfword or one of its
// own pool words), the zero halfwords at the end of its run are alignment padding, not instructions (the
// PoC's `while (run.length && rom.u16(last) === 0) f.insns.delete(...)` in analyzeThumb). The walker drops
// the run's last instruction and asks again, so a run of zeros goes one by one, and the instruction
// before them is then judged by walk.noreturn-call-before-noncode and walk.swi-before-noncode. A zero
// halfword decodes as `movs r0, r0`, so only the stop on non-code tells padding from code.
import { u16 } from '../../../../foundation/rom/rom.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.trailing-zero-padding',
    summary: 'zero halfwords just before non-code are padding, dropped from the reading',
    restsOn: 'agbcc and the assembler pad to a word boundary with zero halfwords before a literal pool (`.align 2, 0`)',
    recovers: 'padding counted as code, and the bl or swi before the padding, which then ends the path',
    reads: ['rom'],
    adds: ['readings'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'thumb' || cursor.phase !== 'stop') return undefined;
    return u16(cursor.view.rom, insn.addr) === 0 ? { step: 'padding' } : undefined;
  },
});
