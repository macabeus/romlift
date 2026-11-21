// gap.forward-chain (the PoC's thumbCandidate): a valid Thumb function at the cursor whose first word is
// not zero and whose extent lies inside the gap. The accept slot's veto (accept.tiny-anchored-at-start)
// judges stubs; the driver compares this proposal with gap.arm-scan's at the same cursor. A word-aligned
// word that holds the address of an accepted Thumb function plus one is a code pointer, not code: the
// rule declines it, and the skip slot steps over it (D60 f).
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import type { AnalysisView } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** The word at `at` is a Thumb pointer to an accepted function: `at` word-aligned, the word odd, the word - 1 a function. */
function pointsAtFunction(at: Addr, v: AnalysisView): boolean {
  const w = u32(v.rom, at);
  return (at & 3) === 0 && (w & 1) === 1 && v.isFunction(w - 1);
}

export default defineRule({
  meta: {
    id: 'gap.forward-chain',
    summary:
      'a valid Thumb reading at the cursor, first word nonzero and no pointer to an accepted function, extent inside [gap start, end), chained forward from the gap start',
    restsOn:
      "compiled functions are laid out back to back, so an unreferenced one starts where the previous one ends, give or take alignment; a literal pool word holding an accepted Thumb function + 1 is that function's address, not code",
    recovers:
      'functions reached only through computed addresses or not at all (dead code, callbacks named in data the harvest missed)',
    reads: ['rom', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'gap-scan',
  },
  kind: 'gap',
  propose(c, v) {
    const at = c.at;
    if (v.isFunction(at) || !contains(v.rom, at, 4) || u32(v.rom, at) === 0 || !v.valid(at) || pointsAtFunction(at, v))
      return undefined;
    const r = v.read(at, 'thumb');
    if (at < c.gap.start || r.end > c.end) return undefined;
    return { entry: at, mode: 'thumb', cites: [at, r.end] };
  },
});
