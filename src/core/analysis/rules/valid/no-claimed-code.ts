// valid.no-claimed-code (the PoC's whyInvalid()): no instruction of the reading starts on a claimed
// byte. The first such instruction by address is reported.
import { hexAddr } from '../../../../foundation/util/hex.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.no-claimed-code',
    summary: 'no instruction of the reading starts on a claimed byte',
    restsOn: 'functions are disjoint: one byte belongs to one function, pool or table',
    recovers: 'readings that run into accepted code, pools or tables',
    reads: ['readings', 'claims'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'pool-claimed',
  intrinsic: true,
  check(r, v) {
    for (const i of r.insns)
      if (v.claimAt(i.addr) !== Claim.free) return `its code overlaps claimed bytes at ${hexAddr(i.addr)}`;
    return undefined;
  },
});
