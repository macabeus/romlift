// bl.target-has-prologue: a far bl whose target opens with a pushed frame is a call (the PoC's settle()
// ladder: `opensWithPrologue(rom, target)`, a word-aligned Thumb `push {.., lr}`). Through the profile's
// isPrologue idiom: a function start, never the continuation of the caller. Asked after
// bl.target-inside-caller, so the target is beyond the caller's code.
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'bl.target-has-prologue',
    summary: 'a bl to a word-aligned Thumb `push {.., lr}` is a call',
    restsOn:
      'agbcc opens every function that calls or spills with `push {.., lr}` on a word boundary; the tail of a function never does',
    recovers: 'calls to functions not yet found, misread as far jumps when they are far from the caller',
    reads: ['rom'],
    adds: ['bl-verdicts'],
  },
  kind: 'bl',
  decide(site, _caller, v) {
    return v.profile.idioms.isPrologue(v.rom, site.target, 'thumb') ? 'call' : undefined;
  },
});
