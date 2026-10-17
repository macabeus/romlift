// seed.adr (the PoC's accept() worklist): the addresses an accepted ARM function computes with `adr`
// that lie in the ROM, word-aligned and above its entry, ascending, as ARM: the startup code names the
// interrupt handler and its helpers this way.
import { contains } from '../../../../foundation/rom/rom.ts';
import { compareNumbers } from '../../../../foundation/util/sorted.ts';
import type { Candidate } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'seed.adr',
    summary: 'word-aligned ROM addresses an ARM function names with adr above its entry are ARM functions',
    restsOn: 'hand-written ARM startup code stores handler addresses computed with adr (the interrupt vector)',
    recovers: 'the interrupt entry and the ARM helpers the startup code installs',
    reads: ['readings', 'rom'],
    adds: ['candidates'],
    origin: 'adr',
  },
  kind: 'queue',
  queue(f, v) {
    if (f.mode !== 'arm') return [];
    const out: Candidate[] = [];
    for (const a of [...f.adrs].sort(compareNumbers)) {
      if (contains(v.rom, a) && (a & 3) === 0 && a > f.entry) out.push({ entry: a, mode: 'arm', proposedBy: 'seed.adr', cites: [f.entry] });
    }
    return out;
  },
});
