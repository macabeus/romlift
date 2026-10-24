// valid.in-rom-unclaimed (the PoC's whyInvalid(), its first two tests): an entry lies in the ROM, on an
// instruction address of its mode (insnAligned: a halfword for the Thumb entries validity judges), and on a byte
// nothing has claimed. It judges the entry before any reading is taken (checkEntry, always a Thumb entry), so
// whyInvalid() asks settle() exactly where the PoC does; `check` gives the same answer for a reading's entry in the
// reading's mode.
import { contains } from '../../../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../foundation/rom/span.ts';
import { insnAligned } from '../../../../foundation/rom/span.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

function whyNot(entry: Addr, mode: Mode, v: AnalysisView): string | undefined {
  if (!contains(v.rom, entry) || !insnAligned(mode, entry)) return 'outside the ROM';
  if (v.claimAt(entry) !== Claim.free) return 'inside claimed bytes';
  return undefined;
}

export default defineRule({
  meta: {
    id: 'valid.in-rom-unclaimed',
    summary: 'the entry is an even ROM address no accepted function or region has claimed',
    restsOn: 'functions are disjoint and Thumb code is halfword-aligned',
    recovers: 'entries inside the code of an accepted function, and pointers that leave the ROM',
    reads: ['rom', 'claims'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'inside-code',
  intrinsic: true,
  checkEntry: (entry, v) => whyNot(entry, 'thumb', v),
  check: (r, v) => whyNot(r.entry, r.mode, v),
});
