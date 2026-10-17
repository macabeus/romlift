// bl.near-is-call: a bl that the profile's far-jump idiom rules out is a call (the PoC's settle() ladder:
// `Math.abs(target - site) < FAR_MIN`). For agbcc the idiom is the distance: a target fewer than
// farJump.minDistance (1,536) bytes from the site is in reach of `b`, so agbcc would not have used bl as a
// jump there; when farJump.requiresPushedLr is set, a caller that does not push lr is ruled out too.
import { readingSummary } from '../../walk/cursor.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.near-is-call',
    summary: 'a bl closer than farJump.minDistance to its target (the far-jump idiom fails) is a call',
    restsOn: 'agbcc emits bl as a jump only when the target is beyond the range of `b`; the shortest far jump in five ROMs is 1,960 bytes',
    recovers: 'nearby calls misread as far jumps, which would glue a neighbouring function into the caller',
    reads: ['readings', 'rom'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, caller, v) {
    const far = v.profile.idioms.matchFarJump(site, readingSummary(caller, v.rom, v.profile));
    return far ? undefined : 'call';
  },
});
