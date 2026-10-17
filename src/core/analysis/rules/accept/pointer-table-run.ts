// accept.pointer-table-run (the PoC's acceptable() and inPointerTable()): a valid candidate proposed by
// seed.data-pointer is taken when a word pointing at it, itself not claimed as code, sits in a run of
// at least pointerTableRun consecutive Thumb pointers whose targets are functions or valid (an m4a
// command table, a callback table). Leaf handlers have no prologue and anchor nothing; they are found
// together. The run grows below the word, then above it, and stops as soon as it is long enough.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import { provenance } from '../../../provenance/provenance.ts';
import { isThumbPointer, pointersTo } from '../../pointers.ts';
import { Claim } from '../../types.ts';
import type { AnalysisView } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

/** The word at `a` points at a function, or at an entry the validity service accepts. */
function pointsAtCode(a: Addr, v: AnalysisView): boolean {
  if (!contains(v.rom, a, 4)) return false;
  const w = u32(v.rom, a);
  return isThumbPointer(v.rom, w) && (v.isFunction(w - 1) || v.valid(w - 1));
}

/** The first word pointing at `entry` that sits in a long enough run, or undefined. */
function tableWord(entry: Addr, v: AnalysisView): Addr | undefined {
  const run = v.profile.pointerTableRun;
  for (const off of pointersTo(v.pointers, entry)) {
    const at = v.rom.base + off;
    if (v.claimAt(at) === Claim.code) continue;
    let n = 1;
    for (let a = at - 4; n < run && pointsAtCode(a, v); a -= 4) n += 1;
    for (let a = at + 4; n < run && pointsAtCode(a, v); a += 4) n += 1;
    if (n >= run) return at;
  }
  return undefined;
}

export default defineRule({
  meta: {
    id: 'accept.pointer-table-run',
    summary: 'a valid candidate named from a run of Thumb pointers to code is a function',
    restsOn: 'tables of handlers are consecutive func+1 words, and every entry of such a table is code',
    recovers: 'leaf handlers with no prologue and no anchor, reached only from a table',
    reads: ['pointer-index', 'claims', 'function-set', 'validity', 'rom'],
    adds: ['function-set'],
  },
  kind: 'accept',
  reason: 'unanchored',
  holds(c, r, v) {
    if (c.proposedBy !== 'seed.data-pointer') return undefined;
    const at = tableWord(r.entry, v);
    return at === undefined ? undefined : provenance('accept.pointer-table-run', v.round, [r.entry, at, ...c.cites], 'in a pointer table');
  },
});
