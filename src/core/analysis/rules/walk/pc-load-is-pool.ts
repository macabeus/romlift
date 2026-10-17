// walk.pc-load-is-pool: a pc-relative load names a literal-pool word (the PoC's `ldr_pc` branch of
// analyzeThumb and analyzeArm). The walker records the word with its value and keeps walking: the word is
// data, so walking into it later stops the path. In Thumb a pool word that does not fit in the ROM is a
// decode error (`pool-out-of-rom`, the PoC's `arg + 4 > rom.end`); in ARM it is simply not recorded (the
// PoC records it only when it is in the ROM). ARM `ldr pc, [pc, #imm]` is a pool load as well: the PoC
// classifies it before any write to pc, so the path goes on.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.pc-load-is-pool',
    summary: 'a pc-relative load names a literal-pool word, recorded with its value; the path goes on',
    restsOn: 'agbcc and the assembler place the constants a function loads with `ldr rd, [pc, #imm]` in literal pools',
    recovers: 'pool words decoded as instructions, and the pointers a pool holds (seed.pool-pointer reads them)',
    reads: ['rom'],
    adds: ['readings'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.phase !== 'insn' || insn.flow.kind !== 'pool-load') return undefined;
    return { step: 'pool', addr: insn.flow.pool };
  },
});
