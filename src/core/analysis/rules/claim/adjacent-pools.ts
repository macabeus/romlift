// claim.adjacent-pools: the extent of a reading and the claims inside it (the PoC's Func.end and the pool
// and table lines of claim()). extentEnd: the code end, extended by every pool word or jump table that
// starts within profile.extentPoolGap (8) bytes of the end so far, until none does: hand-written code
// loads pools hundreds of bytes away, and those are claimed but stay outside the extent. claims: the pool
// words inside [entry, end) as pool when their first byte is still free, then every jump table as table,
// overwriting, as claim() writes them. `r` is the reading being claimed (an absorbed block's own reading
// when it is absorbed), so its own entry and end bound it.
import type { Addr } from '../../../../foundation/rom/span.ts';
import { Claim } from '../../types.ts';
import type { ClaimEdit } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'claim.adjacent-pools',
    summary: 'the extent is the code plus the pools and tables right after it; claim those pools and every table',
    restsOn: 'agbcc emits a function\'s literal pool and switch tables right after its code, separated only by alignment',
    recovers: 'pools and tables that would be free bytes for the gap scan to misread as functions',
    reads: ['readings', 'claims'],
    adds: ['claims'],
  },
  kind: 'claim',
  claims(_f, r) {
    const edits: ClaimEdit[] = [];
    for (const p of r.pools) {
      if (p.addr >= r.entry && p.addr + 4 <= r.end) edits.push({ span: { start: p.addr, end: p.addr + 4 }, kind: Claim.pool, when: 'start-free' });
    }
    for (const t of r.tables) edits.push({ span: { start: t.base, end: t.base + 4 * t.targets.length }, kind: Claim.table, when: 'always' });
    return edits;
  },
  extentEnd(shape, profile) {
    const items: { readonly start: Addr; readonly end: Addr }[] = [
      ...shape.pools.map((p) => ({ start: p, end: p + 4 })),
      ...shape.tables.map((t) => ({ start: t.base, end: t.base + 4 * t.targets.length })),
    ].sort((a, b) => a.start - b.start || a.end - b.end);
    // In start order one pass reaches the PoC's fixpoint: the end only grows, so an item that starts too
    // far past it ends the scan, and one that ended before it never extends it later.
    let end = shape.codeEnd;
    for (const item of items) {
      if (item.start > end + profile.extentPoolGap) break;
      if (item.end > end) end = item.end;
    }
    return end;
  },
});
