// gap.forward-chain (the PoC's thumbCandidate): a valid Thumb function at the cursor whose first word is
// not zero and whose extent lies inside the gap. The accept slot's veto (accept.tiny-anchored-at-start)
// judges stubs; the driver compares this proposal with gap.arm-scan's at the same cursor.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'gap.forward-chain',
    summary: 'a valid Thumb reading at the cursor, first word nonzero, extent inside [gap start, end), chained forward from the gap start',
    restsOn: 'compiled functions are laid out back to back, so an unreferenced one starts where the previous one ends, give or take alignment',
    recovers: 'functions reached only through computed addresses or not at all (dead code, callbacks named in data the harvest missed)',
    reads: ['rom', 'function-set', 'readings', 'validity'],
    adds: ['candidates'],
    origin: 'gap-scan',
  },
  kind: 'gap',
  propose(c, v) {
    const at = c.at;
    if (v.isFunction(at) || !contains(v.rom, at, 4) || u32(v.rom, at) === 0 || !v.valid(at)) return undefined;
    const r = v.read(at, 'thumb');
    if (at < c.gap.start || r.end > c.end) return undefined;
    return { entry: at, mode: 'thumb', cites: [at, r.end] };
  },
});
