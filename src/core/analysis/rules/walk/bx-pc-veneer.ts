// walk.bx-pc-veneer: a Thumb `bx pc` switches to ARM at the next word, (pc + 4) & ~3, and ends the Thumb
// path as a return (the PoC's `bx` branch of analyzeThumb with register 15: `f.veneers.add((pc + 4) &
// ~3)`). The ARM code there is a veneer, proposed as an ARM function by seed.veneer at acceptance. The
// decoder already computes the target (Flow 'mode-switch'); the stack delta at the switch is counted in
// the balance like any return.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.bx-pc-veneer',
    summary: 'Thumb `bx pc` ends the path and names the ARM veneer at the next word',
    restsOn: 'interworking stubs switch from Thumb to ARM with `bx pc` (often after `nop`), continuing in ARM at the next word boundary',
    recovers: 'ARM veneers and the ARM code behind them, reachable only through the mode switch',
    reads: ['rom'],
    adds: ['readings', 'exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.phase !== 'insn' || insn.flow.kind !== 'mode-switch') return undefined;
    return { step: 'switch-mode', target: insn.flow.target };
  },
});
