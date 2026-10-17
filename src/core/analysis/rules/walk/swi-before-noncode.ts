// walk.swi-before-noncode: when a Thumb path runs into non-code right after a `swi` (once the zero
// padding is dropped), the BIOS call does not return there and the path ends as a return (the PoC's
// `else if (last && last[1] === 'swi') f.returns += 1` in analyzeThumb: "a BIOS call that never
// returns", such as SoftReset). No stack balance is recorded for it, as in the PoC. Any other instruction
// before non-code leaves the path as a decode error.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.swi-before-noncode',
    summary: 'a swi followed by non-code ends the path as a return (a BIOS call that never returns)',
    restsOn: 'the BIOS calls SoftReset and HardReset never return, and the library stubs that make them have nothing after the swi',
    recovers: 'BIOS stubs that end in a swi, which would otherwise read as not code',
    reads: ['rom'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.mode !== 'thumb' || cursor.phase !== 'stop' || insn.flow.kind !== 'swi') return undefined;
    return { step: 'end-path', exit: 'swi-end' };
  },
});
