// gap.arm-scan (the PoC's armAhead and armCandidate): an unreferenced ARM function at the cursor, or up to
// armFrontPoolWords words ahead of it past pool words and tables of its own. A reading qualifies when it
// opens with an unconditional instruction that is not a branch, has at least gapScan.minInsns
// instructions, decodes without error, returns, ends inside the gap, is dense unless it fills the gap
// within fillSlack, and overlaps no claimed code. It is taken at the cursor, when a pool word or a pool
// value refers back into the words it skipped, or one word ahead when it has armMinInsnsForSkip
// instructions.
import { decode, isConditional } from '../../../../foundation/isa/decode.ts';
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { insnAligned } from '../../../../foundation/rom/span.ts';
import { toRun } from '../../address-map.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView, Reading } from '../../types.ts';
import { isDense } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

/** The PoC's armCandidate(entry, hi). */
function armReading(v: AnalysisView, entry: Addr, end: Addr): Reading | undefined {
  const { rom, profile } = v;
  if (!insnAligned('arm', entry) || !contains(rom, entry, 4)) return undefined;
  const first = decode('arm', u32(rom, entry), toRun(v.addresses, entry));
  const flow = first.flow.kind;
  if (flow === 'branch' || flow === 'invalid' || isConditional(first)) return undefined;
  const r = v.read(entry, 'arm');
  if (r.insns.length < profile.gapScan.minInsns || r.errors.length > 0 || r.returns === 0 || r.codeEnd > end) return undefined;
  if (end - r.codeEnd > profile.gapScan.fillSlack && !isDense(r, profile)) return undefined;
  if (r.insns.some((i) => v.claimAt(i.addr) !== Claim.free) || r.pools.some((p) => v.claimAt(p.addr) === Claim.code)) return undefined;
  return r;
}

export default defineRule({
  meta: {
    id: 'gap.arm-scan',
    summary: 'an ARM function at the cursor or up to armFrontPoolWords words ahead of its own pools and tables, unreached by any reference',
    restsOn: 'hand-written ARM keeps literal pools before its code and dispatches through branch tables, and is entered through RAM copies or computed jumps',
    recovers: 'heap, OAM and map routines in ARM that no accepted code refers to',
    reads: ['rom', 'claims', 'readings'],
    adds: ['candidates'],
    origin: 'arm-gap-scan',
  },
  kind: 'gap',
  reason: 'arm-unreached',
  propose(c, v) {
    for (let k = 0; k <= v.profile.gapScan.armFrontPoolWords; k++) {
      const q = c.at + 4 * k;
      if (q + 4 > c.end) break;
      const r = armReading(v, q, c.end);
      if (r === undefined) continue;
      const back = (a: Addr): boolean => a >= c.at && a < q;
      const front = r.pools.some((p) => back(p.addr) || back(p.value));
      if (k === 0 || front || (k === 1 && r.insns.length >= v.profile.gapScan.armMinInsnsForSkip)) {
        return { entry: q, mode: 'arm', cites: [q, c.at] };
      }
    }
    return undefined;
  },
});
