// gap.adr-block-absorb (the PoC's absorbBlock): a block at the start of a gap that the Thumb function just
// before it names with `add rd, pc, #imm`, and that leaves only by branching back into that function, is
// that function's code. The driver merges it, claims it and accepts its calls; absorbRun's halfword and
// zero-halfword retries are the driver's.
import { contains, u16 } from '../../../../foundation/rom/rom.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.adr-block-absorb',
    summary: "a gap-start block named by the previous Thumb function's add rd, pc, #imm that only branches back into it is merged into that function",
    restsOn: 'hand-written interrupt handlers store a callback block with add rd, pc, #imm and return through the code of the function that names it',
    recovers: 'handler blocks reported as functions of their own (Emerald multiboot handlers) and the extent of the function that owns them',
    reads: ['rom', 'claims', 'function-set', 'readings'],
    adds: ['claims', 'readings'],
    origin: 'gap-scan',
  },
  kind: 'gap-absorb',
  absorb(c, v) {
    const { rom, profile } = v;
    const at = c.at;
    if (v.claimAt(at) !== Claim.free || at + 2 > c.end || !contains(rom, at, 2) || u16(rom, at) === 0) return undefined;
    const into = v.adrOwner(at);
    const g = into === undefined ? undefined : v.accepted(into);
    if (into === undefined || g === undefined || g.mode !== 'thumb') return undefined;
    if (g.end < c.gap.start - profile.anchorSlack || g.entry >= c.gap.start || profile.idioms.isPrologue(rom, at, 'thumb')) return undefined;
    const block = v.read(at, 'thumb');
    if (block.insns.length === 0 || block.errors.length > 0 || block.codeEnd > c.end) return undefined;
    if (block.returns === 0 || block.tailExits !== block.returns || !block.tails.every((t) => g.insnAt.has(t))) return undefined;
    return { into, span: { start: at, end: block.end } };
  },
});
