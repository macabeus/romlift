// claim.dead-code-in-extent: a dense reading's unreached bytes inside its extent are its dead code (the
// PoC's claim(): "a compiled function is contiguous: the few bytes its walk never reached (a branch arm
// nothing jumps to, padding before a pool) are its dead code, not a place for another function to
// start"). Dense is the PoC's dense(): the holes stay within max(density.minHoles, extent >>
// density.holeShift) bytes (walk/cursor.ts isDense). Only bytes still free are written, after the code,
// pool and table claims; a reading that is not dense claims nothing here, so its holes stay free for the
// gap scan (gap.tiled-hole). One exception (D60 d): when the reading opens with an entry stub
// `movs rX, #k; b T`, an unreached copy of that stub (the same rX and T) inside the extent is another
// entry of the same table of stubs, not dead code, and its four bytes stay free.
import { decode } from '@match-kit/isa/armv4t';

import { thumbWordAt } from '../../../../foundation/rom/rom.ts';
import { contains } from '../../../../foundation/rom/rom.ts';
import type { Addr } from '../../../../foundation/rom/span.ts';
import type { AnalysisView, ClaimEdit, Reading } from '../../types.ts';
import { Claim } from '../../types.ts';
import { isDense } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

/** The length of the entry stub `movs rX, #k; b T`. */
const STUB_BYTES = 4;

/** The entry stub `movs rX, #k; b T` at `a`, as `rX:T`, or undefined. */
function entryStub(a: Addr, v: AnalysisView): string | undefined {
  if (!contains(v.rom, a, STUB_BYTES)) return undefined;
  const mov = decode('thumb', thumbWordAt(v.rom, a), a);
  if (mov.specId !== 'thumb.mov_imm') return undefined;
  const jump = decode('thumb', thumbWordAt(v.rom, a + 2), a + 2).flow;
  if (jump.kind !== 'branch' || jump.conditional) return undefined;
  return `${String(mov.fields['rd'])}:${jump.target}`;
}

/** Unreached copies of the reading's own entry stub inside its extent, ascending. */
function stubCopies(r: Reading, v: AnalysisView): Addr[] {
  if (r.mode !== 'thumb') return [];
  const own = entryStub(r.entry, v);
  if (own === undefined) return [];
  const copies: Addr[] = [];
  const step = v.profile.alignment.thumbFunction;
  for (let a = r.entry + STUB_BYTES; a + STUB_BYTES <= r.end; a += step) {
    if (r.insnAt.has(a) || r.insnAt.has(a + 2) || entryStub(a, v) !== own) continue;
    copies.push(a);
    a += STUB_BYTES - step;
  }
  return copies;
}

export default defineRule({
  meta: {
    id: 'claim.dead-code-in-extent',
    summary:
      "a dense function's free bytes inside its extent are claimed as dead code, except unreached copies of its own `movs rX, #k; b T` entry stub",
    restsOn:
      'a compiled function is one contiguous run, so the few bytes inside it the walk never reached are still its own; a table of entry stubs `movs rX, #k; b T` that share one tail gives each entry its own constant, so an unreached copy of the entry stub is another entry, not dead code',
    recovers: "functions proposed inside another function's unreached branch arms or alignment padding",
    reads: ['readings', 'rom', 'claims'],
    adds: ['claims'],
  },
  kind: 'claim',
  claims(_f, r, v) {
    if (r.end <= r.entry || !isDense(r, v.profile)) return [];
    const edits: ClaimEdit[] = [];
    let from = r.entry;
    for (const a of stubCopies(r, v)) {
      if (a > from) edits.push({ span: { start: from, end: a }, kind: Claim.dead, when: 'free-bytes' });
      from = a + STUB_BYTES;
    }
    if (r.end > from) edits.push({ span: { start: from, end: r.end }, kind: Claim.dead, when: 'free-bytes' });
    return edits;
  },
});
