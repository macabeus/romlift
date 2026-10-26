// region.data-after-code (the PoC's codeRange): the code end is the greatest extent end of an accepted
// function, and every free byte after it is data. It runs after the passes, so it changes no function and
// no extent.
import { Claim, codeEnd } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

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
