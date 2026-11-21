// walk.branch-into-function: a `b` or `bcc` whose target is an accepted function or code another
// function claimed is a tail exit, not a path to follow (the PoC's `b`/`bcc` branches of analyzeThumb and
// analyzeArm: `foreign = arg !== entry && !f.insns.has(arg) && (funcs.has(arg) || claimed === code)`).
// A target this walk already reached, and the entry itself, are the function's own loop. In ARM a target
// below the entry is foreign too. The walker counts the exit (and the call when the target is a
// function); an unconditional branch ends the path, a conditional one goes on.
//
// In the canonical pass (D114) a forward branch is foreign when its target lies past another boundary entry (one
// that is not an inner label), that is in the code of another function as the source lays the functions out,
// whatever the claims say: a shared tail belongs to the entry it follows, whichever function was read first. A
// backward branch is judged as before (ARM: foreign; Thumb: a boundary entry or claimed code), the claims then being
// those of the lower entries' final readings only, which the pass rebuilds in ascending order.
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'walk.branch-into-function',
    summary: 'a branch into another function or claimed code (ARM: or below the entry) is a tail exit',
    restsOn:
      'a function never jumps into another function except as a tail call; agbcc and hand-written code share epilogues only by tail branches',
    recovers: "two functions glued into one by a tail branch, and claims of another function's code",
    reads: ['function-set', 'claims', 'readings'],
    adds: ['exits'],
  },
  kind: 'walk',
  onInsn(insn, cursor) {
    if (cursor.phase !== 'insn' || insn.flow.kind !== 'branch') return undefined;
    const target = insn.flow.target;
    if (target === cursor.entry || cursor.walked(target)) return undefined;
    const v = cursor.view;
    const past = v.boundaryBetween(cursor.entry, target);
    if (past !== undefined) {
      const leaves =
        target > cursor.entry
          ? past
          : cursor.mode === 'arm' || v.isBoundary(target) || v.claimAt(target) === Claim.code;
      return leaves ? { step: 'end-path', exit: 'tail' } : undefined;
    }
    const below = cursor.mode === 'arm' && target < cursor.entry;
    const foreign = below || v.isFunction(target) || v.claimAt(target) === Claim.code;
    return foreign ? { step: 'end-path', exit: 'tail' } : undefined;
  },
});
