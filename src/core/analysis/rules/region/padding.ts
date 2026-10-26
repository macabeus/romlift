// region.padding (the plan's "zero halfwords before an aligned address are padding"): a free run between
// claimed bytes below the code end whose bytes are all padding (profile.idioms.isPadding), shorter than
// the alignment of the item after it and ending on that alignment, becomes a padding claim. It runs after
// the passes, so it changes no function and no extent.
import type { Addr } from '../../../../foundation/rom/span.ts';
import { Claim, codeEnd } from '../../types.ts';
import type { AnalysisView, ClaimEdit, ClaimKind } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** Whether the free run [start, stop) aligns the claimed item at `stop`. */
function aligns(v: AnalysisView, start: Addr, stop: Addr, next: ClaimKind): boolean {
  const align = next === Claim.pool || next === Claim.table ? v.profile.alignment.pool : v.profile.alignment.cFunction;
  if (stop - start >= align || (stop - v.rom.base) % align !== 0) return false;
  for (let a = start; a < stop; a++) if (!v.profile.idioms.isPadding(v.rom, a)) return false;
  return true;
}

export default defineRule({
  meta: {
    id: 'region.padding',
    summary: 'free padding bytes that align the claimed item after them, between claimed bytes below the code end, are claimed as padding',
    restsOn: 'agbcc and as emit .align 2, 0 before every function and literal pool, so the only free bytes between code are the zeros of an alignment',
    recovers: 'alignment zeros emitted as data slices between functions instead of .align',
    reads: ['rom', 'claims', 'function-set'],
    adds: ['claims'],
  },
  kind: 'region',
  classify(v) {
    const edits: ClaimEdit[] = [];
    const end = codeEnd(v);
    for (let a = v.rom.base + 1; a < end; a++) {
      if (v.claimAt(a) !== Claim.free || v.claimAt(a - 1) === Claim.free) continue;
      let stop = a;
      while (stop < end && v.claimAt(stop) === Claim.free) stop++;
      if (stop < end && aligns(v, a, stop, v.claimAt(stop))) edits.push({ span: { start: a, end: stop }, kind: Claim.padding, when: 'free-bytes' });
      a = stop;
    }
    return edits;
  },
});
