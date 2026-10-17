// gap.tiled-hole (the PoC's holeHead): the Thumb reading of a gap's first bytes when it is a function in
// every respect but density or stack balance. The driver accepts it when it fills the gap or is anchored
// at its end, and in the patient pass makes the gap wait for that anchor.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.tiled-hole',
    summary: "a gap's head reads as a function failing at most density or stack balance, with at least gapScan.minInsns instructions, its code inside the gap",
    restsOn: 'hand-written mixers keep ARM blocks and tables inside a Thumb function, so their extent has holes and their paths may not balance the stack',
    recovers: 'SoundMainRAM and other mixers on all five tuning ROMs',
    reads: ['rom', 'claims', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'tiled-hole',
  },
  kind: 'gap-head',
  head(c, v) {
    const at = c.at;
    if (v.isFunction(at) || v.claimAt(at) !== Claim.free || !contains(v.rom, at, 4) || u32(v.rom, at) === 0) return undefined;
    const why = v.whyInvalid(at);
    if (why !== undefined && why.reason !== 'not-dense' && why.reason !== 'pops-frame') return undefined;
    const r = v.read(at, 'thumb');
    if (r.insns.length < v.profile.gapScan.minInsns || r.codeEnd > c.end) return undefined;
    return r;
  },
});
