// bl.self-or-accepted: a bl to the caller's own entry or to an accepted function is a call (the first
// clause of the PoC's settle() ladder: `target === entry || this.funcs.has(target)`). A function that
// is already known starts there, so the bl cannot be a jump into the middle of something. In confirm mode
// "accepted" means listed (AnalysisView.isFunction). First rule of the ladder: a site it answers is never
// judged by the distance or frame rules below it.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.self-or-accepted',
    summary: 'a bl to the caller itself or to an accepted function is a call',
    restsOn:
      'a function entry is only ever called (recursion included); agbcc never uses bl to jump to a function start',
    recovers: 'calls to known functions misread as far jumps, which would glue the callee into the caller',
    reads: ['function-set'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, caller, v) {
    return site.target === caller.entry || v.isFunction(site.target) ? 'call' : undefined;
  },
});
