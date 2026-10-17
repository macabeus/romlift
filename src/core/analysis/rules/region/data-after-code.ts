// region.data-after-code (the PoC's codeRange): the code end is the greatest extent end of an accepted
// function, and every free byte after it is data. It runs after the passes, so it changes no function and
// no extent.
import type { Addr } from '../../../../foundation/rom/span.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** The PoC's codeRange hi: the greatest extent end of an accepted function. */
function codeEnd(v: AnalysisView): Addr {
  let end: Addr = v.rom.base;
  for (const e of v.functions()) {
    const f = v.owner(e);
    end = Math.max(end, f?.entry === e ? f.extent.end : (v.accepted(e)?.end ?? e));
  }
  return end;
}

export default defineRule({
  meta: {
    id: 'region.data-after-code',
    summary: 'the free bytes after the code end (the greatest extent end of an accepted function) are claimed as data',
    restsOn: 'the linker places .text before .rodata and .data, so past the last function the ROM holds data only',
    recovers: 'tables and assets after the code decoded or reported as unexplained gaps',
    reads: ['claims', 'function-set', 'readings'],
    adds: ['claims'],
  },
  kind: 'region',
  classify(v) {
    const end = codeEnd(v);
    return end < v.rom.end ? [{ span: { start: end, end: v.rom.end }, kind: Claim.data, when: 'free-bytes' }] : [];
  },
});
