// walk.branch-into-function: a `b` or `bcc` whose target is an accepted function or code another
// function claimed is a tail exit, not a path to follow (the PoC's `b`/`bcc` branches of analyzeThumb and
// analyzeArm: `foreign = arg !== entry && !f.insns.has(arg) && (funcs.has(arg) || claimed === code)`).
// A target this walk already reached, and the entry itself, are the function's own loop. In ARM a target
// below the entry is foreign too. The walker counts the exit (and the call when the target is a
// function); an unconditional branch ends the path, a conditional one goes on.
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.branch-into-function',
    summary: 'a branch into another function or claimed code (ARM: or below the entry) is a tail exit',
    restsOn: 'a function never jumps into another function except as a tail call; agbcc and hand-written code share epilogues only by tail branches',
    recovers: 'two functions glued into one by a tail branch, and claims of another function\'s code',
    reads: ['function-set', 'claims', 'readings'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.phase !== 'insn' || insn.flow.kind !== 'branch') return undefined;
    const target = insn.flow.target;
    if (target === cursor.entry || cursor.walked(target)) return undefined;
    const v = cursor.view;
    const below = cursor.mode === 'arm' && target < cursor.entry;
    const foreign = below || v.isFunction(target) || v.claimAt(target) === Claim.code;
    return foreign ? { step: 'end-path', exit: 'tail' } : undefined;
  },
});
