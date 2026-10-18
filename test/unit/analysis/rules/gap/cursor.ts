// The gap cursor of a rule test: the free run, the position asked about, the current end (the gap's end
// unless shrunk) and the head. Not a test file; the gap rule tests import it.
import type { Addr } from '../../../../../src/foundation/rom/span.ts';
import type { GapCursor, Reading } from '../../../../../src/core/analysis/types.ts';

export function gapCursor(start: Addr, stop: Addr, at: Addr, opts: { readonly end?: Addr; readonly head?: Reading; readonly pass?: 'patient' | 'impatient' } = {}): GapCursor {
  return { gap: { start, end: stop }, at, end: opts.end ?? stop, ...(opts.head === undefined ? {} : { head: opts.head }), pass: opts.pass ?? 'impatient' };
}
