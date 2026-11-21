// bl.target-beyond-callee: a far bl whose target lies beyond the entry of another function the same caller
// calls is a call. Such an entry is a function start: one the analysis already accepted, or a bl target
// that opens with the profile's prologue (bl.target-has-prologue's evidence). A far jump only continues the
// caller in its own tail, and a function never contains the entry of a function it calls, so a target
// past that entry cannot be the caller's tail. Asked before bl.target-pops-unpushed-frame, whose answer
// for a callee that pops a frame it never pushed would otherwise depend on whether that callee happened to
// be accepted before the caller was settled (the ascending worklist may settle the caller first).
import type { Addr } from '../../../../foundation/rom/span.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.target-beyond-callee',
    summary: 'a bl to an address beyond the entry of another function the caller calls is a call',
    restsOn: "a far jump reaches the caller's own tail, and a function never contains the entry of a function it calls",
    recovers:
      "callees that pop a frame they never pushed, misread as the caller's tail when the caller is settled before them",
    reads: ['readings', 'rom', 'function-set'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, caller, v) {
    const boundary = (t: Addr): boolean => v.isFunction(t) || v.profile.idioms.isPrologue(v.rom, t, 'thumb');
    for (const other of caller.blSites) {
      const t = other.target;
      if (other.site !== site.site && t > caller.entry && t < site.target && boundary(t)) return 'call';
    }
    return undefined;
  },
});
