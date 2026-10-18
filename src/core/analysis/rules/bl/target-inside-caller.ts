// bl.target-inside-caller: a far bl whose target lies below the caller's code end is a jump (the PoC's
// settle() ladder: `target < f.codeEnd` → far, "a callee is never inside its caller"). The code end is
// the one of this settle round's walk, so a target the walk already covers, or one it skips over, is the
// caller's own code. Asked after the call clauses, so the target is ahead of the entry, not a function and
// beyond the near-call distance. The comparison is strict: a target exactly at the code end is the next
// function's start or a tail the later clauses judge. Once far, settle() walks the target as part of the
// caller, which can only raise the code end.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.target-inside-caller',
    summary: 'a bl to an address below the caller\'s code end is a far jump inside the caller',
    restsOn: 'a callee is never inside its caller; agbcc places a function\'s code contiguously',
    recovers: 'far tails of long functions split off as functions of their own',
    reads: ['readings'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, caller) {
    return site.target < caller.codeEnd ? 'far' : undefined;
  },
});
