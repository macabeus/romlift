// gap.adr-block-absorb (the PoC's absorbBlock): a block at the start of a gap that the Thumb function just
// before it names with `add rd, pc, #imm`, and that leaves only by branching back into that function, is
// that function's code. The driver merges it, claims it and accepts its calls, and asks again where the
// block ends (absorbRun). The block may start a halfword on: past a claimed halfword (a block at a
// halfword boundary), or past one zero halfword of alignment (the PoC's absorbRun retries).
import { contains, u16 } from '../../../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../../../foundation/rom/span.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView, GapCursor } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

type Absorbed = { readonly into: Addr; readonly span: Span } | undefined;

/** The block at `at` itself, when the function that names it owns it. */
function blockAt(c: GapCursor, at: Addr, v: AnalysisView): Absorbed {
  const { rom, profile } = v;
  if (v.claimAt(at) !== Claim.free || at + 2 > c.end || !contains(rom, at, 2) || u16(rom, at) === 0) return undefined;
  const into = v.adrOwner(at);
  const g = into === undefined ? undefined : v.accepted(into);
  if (into === undefined || g === undefined || g.mode !== 'thumb') return undefined;
  if (g.end < c.gap.start - profile.anchorSlack || g.entry >= c.gap.start || profile.idioms.isPrologue(rom, at, 'thumb')) return undefined;
  const block = v.read(at, 'thumb');
  if (block.insns.length === 0 || block.errors.length > 0 || block.codeEnd > c.end) return undefined;
  if (block.returns === 0 || block.tailExits !== block.returns || !block.tails.every((t) => g.insnAt.has(t))) return undefined;
  return { into, span: { start: at, end: block.end } };
}

const free = (v: AnalysisView, a: Addr): boolean => v.claimAt(a) === Claim.free;

export default defineRule({
  meta: {
    id: 'gap.adr-block-absorb',
    summary: "a gap-start block named by the previous Thumb function's add rd, pc, #imm that only branches back into it is merged into that function",
    restsOn:
      'hand-written interrupt handlers store a callback block with add rd, pc, #imm and return through the code of the function that names it; ' +
      'the block may start one halfword on, past a claimed halfword or past one zero halfword of alignment (the PoC absorbRun retry, zero only: ' +
      'the assembler aligns such a block with zero fill, not with the mov r8, r8 the profile padding idiom also accepts)',
    recovers:
      'handler blocks reported as functions of their own (Emerald multiboot handlers), also when aligned a halfword on, and the extent of the function that owns them',
    reads: ['rom', 'claims', 'function-set', 'readings'],
    adds: ['claims', 'readings'],
    origin: 'gap-scan',
  },
  kind: 'gap-absorb',
  absorb(c, v) {
    const at = !free(v, c.at) && free(v, c.at + 2) ? c.at + 2 : c.at;
    const found = blockAt(c, at, v);
    if (found !== undefined || !contains(v.rom, at, 2) || u16(v.rom, at) !== 0 || !free(v, at + 2)) return found;
    return blockAt(c, at + 2, v);
  },
});
