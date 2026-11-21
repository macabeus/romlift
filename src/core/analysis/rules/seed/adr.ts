// seed.adr (the PoC's accept() worklist): the addresses an accepted ARM function computes with `adr`
// that lie in the ROM, word-aligned and above its entry, ascending, as ARM: the startup code names the
// interrupt handler and its helpers this way. An `adr` that names a claimed word (code of a function,
// its own extent included: a return address it sets up, a table of its own; or a pool or a table) or
// words that do not read as ARM code names a label or data, not a new function; neither is proposed
// (D60 g).
import { contains } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { compareNumbers } from '../../../../foundation/util/sorted.ts';
import type { AnalysisView, Proposal } from '../../types.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** Whether `a`, named by an adr, can open an ARM function: unclaimed, and read as ARM code without an error. */
function namesCode(a: Addr, v: AnalysisView): boolean {
  if (v.claimAt(a) !== Claim.free) return false;
  const r = v.read(a, 'arm');
  return r.insns.length > 0 && r.errors.length === 0;
}

export default defineRule({
  meta: {
    id: 'seed.adr',
    summary:
      'word-aligned ROM addresses above its entry that an ARM function names with adr, unclaimed and read as ARM code, are ARM functions',
    restsOn:
      'hand-written ARM startup code stores handler addresses computed with adr (the interrupt vector); an adr onto claimed words (code, its own extent included, a pool or a table) is a label or data, and one onto words that do not decode names data',
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
      if (contains(v.rom, a) && (a & 3) === 0 && a > f.entry && namesCode(a, v))
        out.push({ entry: a, mode: 'arm', cites: [f.entry] });
    }
    return out;
  },
});
