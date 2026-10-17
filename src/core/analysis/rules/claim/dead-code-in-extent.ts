// claim.dead-code-in-extent: a dense reading's unreached bytes inside its extent are its dead code (the
// PoC's claim(): "a compiled function is contiguous: the few bytes its walk never reached (a branch arm
// nothing jumps to, padding before a pool) are its dead code, not a place for another function to
// start"). Dense is the PoC's dense(): the holes stay within max(density.minHoles, extent >>
// density.holeShift) bytes (walk/cursor.ts isDense). Only bytes still free are written, after the code,
// pool and table claims; a reading that is not dense claims nothing here, so its holes stay free for the
// gap scan (gap.tiled-hole).
import { isDense } from '../../walk/predicates.ts';
import { Claim } from '../../types.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'claim.dead-code-in-extent',
    summary: 'a dense function\'s free bytes inside its extent are claimed as dead code',
    restsOn: 'a compiled function is one contiguous run, so the few bytes inside it the walk never reached are still its own',
    recovers: 'functions proposed inside another function\'s unreached branch arms or alignment padding',
    reads: ['readings', 'rom', 'claims'],
    adds: ['claims'],
  },
  kind: 'claim',
  claims(_f, r, v) {
    if (r.end <= r.entry || !isDense(r, v.profile)) return [];
    return [{ span: { start: r.entry, end: r.end }, kind: Claim.dead, when: 'free-bytes' }];
  },
});
