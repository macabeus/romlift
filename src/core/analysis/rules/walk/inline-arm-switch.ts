// walk.inline-arm-switch: a Thumb `bx rN` whose run sets rN with `add rN, pc, #imm` (adr) to the first
// word boundary after the bx switches to ARM code in place. That ARM code is the rest of this function:
// the walker walks it for its extent (Reading.armTails), so the function's extent covers it, and leaves
// its bytes free for the ARM code's own discovery; the Thumb path ends at the bx as a register jump.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.inline-arm-switch',
    summary: 'Thumb `adr rN, L; bx rN` with L the next word: the ARM code at L is the tail of this function, inside its extent',
    restsOn: 'hand-written code enters ARM in place with `add rN, pc, #0; bx rN` and runs the ARM body right after it as one function (m4a umul3232H32, typed as one 16-byte function by pret and SAT-R)',
    recovers: 'the extent of a Thumb entry whose body is ARM, which would end at its bx',
    reads: ['rom', 'readings'],
    adds: ['readings', 'exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'thumb' || cursor.phase !== 'insn' || insn.flow.kind !== 'indirect' || insn.flow.via !== 'bx') return undefined;
    const reg = insn.flow.reg;
    const prev = cursor.back(1);
    if (prev === undefined || prev.flow.kind !== 'adr' || prev.fields['rd'] !== reg) return undefined;
    const next = (insn.addr + insn.size + 3) & ~3;
    return prev.flow.target === next ? { step: 'arm-tail', target: next } : undefined;
  },
});
