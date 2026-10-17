// seed.adr (the PoC's accept() worklist): the addresses an accepted ARM function computes with `adr`
// that lie in the ROM, word-aligned and above its entry, ascending, as ARM: the startup code names the
// interrupt handler and its helpers this way. An `adr` that names a word inside the function's own
// extent names a local label (a return address it sets up, a table of its own), and one that names a
// claimed word or words that do not read as ARM code names data; neither is proposed (D60 g).
import { contains } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { compareNumbers } from '../../../../foundation/util/sorted.ts';
import type { AnalysisView, FunctionFact, Proposal } from '../../types.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** Whether `a`, named by an adr of `f`, can open an ARM function: outside f's extent, unclaimed, and read as ARM code without an error. */
function namesCode(f: FunctionFact, a: Addr, v: AnalysisView): boolean {
  if (a < f.extent.end) return false;
  if (v.claimAt(a) !== Claim.free) return false;
  const r = v.read(a, 'arm');
  return r.insns.length > 0 && r.errors.length === 0;
}

export default defineRule({
  meta: {
    id: 'seed.adr',
    summary: 'word-aligned ROM addresses past its extent that an ARM function names with adr, unclaimed and read as ARM code, are ARM functions',
    restsOn:
      'hand-written ARM startup code stores handler addresses computed with adr (the interrupt vector); an adr into the function\'s own extent is a local label, and one onto words that are claimed or do not decode names data',
    recovers: 'the interrupt entry and the ARM helpers the startup code installs',
    reads: ['readings', 'rom', 'claims'],
    adds: ['candidates'],
    origin: 'adr',
  },
  kind: 'queue',
  queue(f, v) {
    if (f.mode !== 'arm') return [];
    const out: Proposal[] = [];
    for (const a of [...f.adrs].sort(compareNumbers)) {
      if (contains(v.rom, a) && (a & 3) === 0 && a > f.entry && namesCode(f, a, v)) out.push({ entry: a, mode: 'arm', cites: [f.entry] });
    }
    return out;
  },
});
