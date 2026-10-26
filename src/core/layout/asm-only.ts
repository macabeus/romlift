// The assembly-only ranges (architecture §6.2, D20): a run of code agbcc cannot have produced (ARM code, a Thumb
// entry at 2 mod 4, a shared tail, a tiled hole, a Thumb `bx pc` mode switch) stays in one assembly-only module, so
// no border falls strictly inside one.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import type { FunctionFact } from '../analysis/types.ts';
import { WORD } from './align.ts';
import type { TiledChunk } from './tiling.ts';

/** The rule whose tail exits are shared tails: a branch into another function. */
const SHARED_TAIL_RULE = 'walk.branch-into-function';

/** Why agbcc cannot have produced a function. */
export type AsmOnlyReason = 'arm' | 'unaligned-entry' | 'shared-tail' | 'tiled-hole' | 'mode-switch';

/** The reasons a function is assembly-only; empty when agbcc may have produced it. */
export function asmOnlyReasons(f: FunctionFact): AsmOnlyReason[] {
  const reasons: AsmOnlyReason[] = [];
  if (f.mode === 'arm') reasons.push('arm');
  if (f.mode === 'thumb' && f.entry % WORD !== 0) reasons.push('unaligned-entry');
  if (f.exits.some((x) => x.kind === 'tail' && x.rule === SHARED_TAIL_RULE)) reasons.push('shared-tail');
  if (f.holes.length > 0) reasons.push('tiled-hole');
  // A Thumb `bx pc` (walk.bx-pc-veneer) is an interworking veneer's first half, `bx pc; nop` before the ARM code at
  // the next word: agbcc emits no `bx pc`, so the stub joins its ARM half in one assembly module instead of a C
  // module of its own (final-review end-to-end-user-3: klonoa's six linker thunks made eleven 4-byte modules).
  if (f.mode === 'thumb' && f.veneers.length > 0) reasons.push('mode-switch');
  return reasons;
}

/**
 * The assembly-only ranges among `chunks` (in address order) that start at or after `from`: each run of
 * consecutive assembly-only function chunks, with any orphan chunks between them, from the first one's start
 * to the last one's end.
 */
export function asmOnlyRanges(chunks: readonly TiledChunk[], facts: ReadonlyMap<Addr, FunctionFact>, from: Addr): Span[] {
  const out: Span[] = [];
  let open: { start: Addr; end: Addr } | undefined;
  for (const c of chunks) {
    if (c.entry === undefined || c.span.start < from) continue;
    const fact = facts.get(c.entry);
    if (fact !== undefined && asmOnlyReasons(fact).length > 0) {
      if (open === undefined) open = { start: c.span.start, end: c.span.end };
      else open.end = c.span.end;
    } else if (open !== undefined) {
      out.push(open);
      open = undefined;
    }
  }
  if (open !== undefined) out.push(open);
  return out;
}

