// accept.tiny-anchored-at-start (the tiny-candidate veto of the PoC's thumbCandidate()): a gap-scan
// candidate (the forward chain's) of fewer than tinyFunctionInsns instructions (a stub: `bx lr`, `bx rN`, `movs; bx lr`) is
// taken only when it is anchored at start and does not open with b, bcc or bl, which a stray halfword
// pair in data often does.
import { decode } from '../../../../foundation/isa.ts';
import { thumbWordAt } from '../../../../foundation/rom/rom.ts';
import { contains } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import type { AnalysisView } from '../../types.ts';
import { anchoredAtStart } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

/** The entry's first Thumb instruction is a branch (b, bcc) or a bl. */
function opensWithBranch(entry: Addr, v: AnalysisView): boolean {
  if (!contains(v.rom, entry, 2)) return false;
  const kind = decode('thumb', thumbWordAt(v.rom, entry), entry).flow.kind;
  return kind === 'branch' || kind === 'bl';
}

export default defineRule({
  meta: {
    id: 'accept.tiny-anchored-at-start',
    summary: 'a gap-scan stub of fewer than tinyFunctionInsns instructions needs a start anchor and no opening branch',
    restsOn: 'real stubs sit right after the code before them and start with a register move or a return',
    recovers: 'one- and two-instruction readings of padding or data inside a gap',
    reads: ['readings', 'claims', 'rom'],
    adds: [],
  },
  kind: 'accept-veto',
  reason: 'unanchored',
  vetoes(c, r, v) {
    if (v.originOf(c.proposedBy) !== 'gap-scan' || r.insns.length >= v.profile.tinyFunctionInsns) return undefined;
    if (!anchoredAtStart(r.entry, v)) return `a stub of ${r.insns.length} instructions, not anchored at start`;
    if (opensWithBranch(r.entry, v)) return `a stub of ${r.insns.length} instructions that opens with a branch`;
    return undefined;
  },
});
