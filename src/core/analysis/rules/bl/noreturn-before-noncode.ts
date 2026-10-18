// bl.noreturn-before-noncode: a refinement, asked after the verdict for a site that is a call or was
// deferred: when the caller's walk stopped on non-code right after the site (Reading.deadEnd, set by
// walk.noreturn-call-before-noncode), the call never returns (the PoC's settle(): `if
// (f.deadEnd.has(site) && !noret.has(site)) noret.add(site)`, for 'call' and null verdicts). settle() then
// walks the caller again with the path ending at the site, so nothing after it is read as code.
import { defineRule } from '../define-rule.ts';

/** Whether `site` is in the sorted list `deadEnd`. */
function inSorted(deadEnd: readonly number[], site: number): boolean {
  let lo = 0;
  let hi = deadEnd.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const a = deadEnd[mid] ?? 0;
    if (a === site) return true;
    if (a < site) lo = mid + 1;
    else hi = mid;
  }
  return false;
}

export default defineRule({
  meta: {
    id: 'bl.noreturn-before-noncode',
    summary: 'a call followed by non-code in the caller never returns',
    restsOn: 'agbcc emits nothing after a call to a function that never returns, so the bytes after it are a pool or another function',
    recovers: 'pools and neighbouring functions read as the code after a never-returning call',
    reads: ['readings'],
    adds: ['bl-verdicts', 'exits'],
  },
  kind: 'bl',
  refines: true,
  decide(site, caller) {
    return inSorted(caller.deadEnd, site.site) ? 'noreturn' : undefined;
  },
});
