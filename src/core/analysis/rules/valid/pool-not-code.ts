// valid.pool-not-code (the PoC's whyInvalid()): no literal-pool word the reading loads is claimed as
// code. A pool may be shared with another function, but a word that executes is never data. Pools are
// checked in walk order.
import { hexAddr } from '../../../../foundation/util/hex.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.pool-not-code',
    summary: 'no literal-pool word the reading loads is claimed as code',
    restsOn: 'agbcc keeps literal pools out of the instruction stream',
    recovers: 'readings whose pc-relative loads point into accepted code',
    reads: ['readings', 'claims'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'pool-claimed',
  intrinsic: true,
  check(r, v) {
    for (const p of r.pools) if (v.claimAt(p.addr) === Claim.code) return `its pool at ${hexAddr(p.addr)} is claimed code`;
    return undefined;
  },
});
