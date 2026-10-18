// valid.returns-or-prologue (the PoC's whyInvalid()): a reading with no return, tail exit, register
// jump or swi end must at least open with the raw `push {.., lr}` of a frame (a function whose every
// path ends in a call that never returns).
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.returns-or-prologue',
    summary: 'the reading returns somewhere, or opens with push {.., lr}',
    restsOn: 'a compiled function either returns or pushes lr before calling what never returns',
    recovers: 'runs of data that decode without ever returning',
    reads: ['readings', 'rom'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'no-return-no-prologue',
  intrinsic: true,
  check(r, v) {
    if (r.returns > 0 || v.profile.idioms.opensWithPushLr(v.rom, r.entry)) return undefined;
    return 'no return and no push {.., lr}';
  },
});
