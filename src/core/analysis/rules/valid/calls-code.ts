// valid.calls-code (the PoC's whyInvalid() and couldBeCode()): every Thumb callee that is not a function
// could be code: an even ROM address with a word left, not in a pool or table, not 0 or 0xFFFFFFFF, whose
// own reading (through the view, memoised by the driver) has instructions and no error. Not intrinsic:
// the callee may be accepted later, so the failure is kept only for the epoch.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { hexAddr } from '../../../../foundation/util/hex.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

function couldBeCode(t: Addr, v: AnalysisView): boolean {
  if (!contains(v.rom, t, 4) || (t & 1) !== 0) return false;
  const claim = v.claimAt(t);
  if (claim === Claim.pool || claim === Claim.table) return false;
  const w = u32(v.rom, t);
  if (w === 0 || w === 0xffff_ffff) return false;
  const g = v.read(t, 'thumb');
  return g.insns.length > 0 && g.errors.length === 0;
}

export default defineRule({
  meta: {
    id: 'valid.calls-code',
    summary: 'every Thumb callee that is not a function could be code',
    restsOn: 'a compiled function calls only code',
    recovers: 'data decoded as code whose bl pairs point into pools, tables, blank or undecodable bytes',
    reads: ['readings', 'function-set', 'claims', 'rom'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'calls-non-code',
  intrinsic: false,
  check(r, v) {
    for (const c of r.calls) {
      if (c.mode === 'thumb' && !v.isFunction(c.target) && !couldBeCode(c.target, v)) return `calls ${hexAddr(c.target)}, which is not code`;
    }
    return undefined;
  },
});
