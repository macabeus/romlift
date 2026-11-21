// claim.far-pools: the pool words a reading loaded outside its extent are claimed as pool too, when their
// first byte is still free (the PoC's claim(): every pool of the function, not only the adjacent ones,
// `if (!claimed[p]) fill(pool)`). Hand-written code and long functions load constants from a pool
// hundreds of bytes away, often inside another function's extent; the word is data whoever owns the bytes
// around it. A word another claim already took (code, a table, another pool) is left as it is. The
// extent is the one of `r`, the reading being claimed, as claim.adjacent-pools computed it, so the two
// rules claim disjoint sets of words.
import { Claim } from '../../types.ts';
import type { ClaimEdit } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'claim.far-pools',
    summary: 'pool words loaded from outside the extent are claimed as pool unless already claimed',
    restsOn:
      'a word loaded with `ldr rd, [pc, #imm]` is data wherever it sits; hand-written code shares pools across functions',
    recovers: 'far pool words that the gap scan would misread as code or as the start of a function',
    reads: ['readings', 'claims'],
    adds: ['claims'],
  },
  kind: 'claim',
  claims(_f, r) {
    const edits: ClaimEdit[] = [];
    for (const p of r.pools) {
      if (p.addr >= r.entry && p.addr + 4 <= r.end) continue;
      edits.push({ span: { start: p.addr, end: p.addr + 4 }, kind: Claim.pool, when: 'start-free' });
    }
    return edits;
  },
});
