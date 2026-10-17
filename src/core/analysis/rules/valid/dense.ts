// valid.dense (the PoC's whyInvalid() and dense()): the bytes of [entry, end) no instruction, pool or
// table covers stay within max(density.minHoles, extent >> density.holeShift); a zero halfword right
// before a covered byte (or the end) is alignment padding, not a hole. The reading counts its holes
// once, when it is built.
import { isDense } from '../../walk/predicates.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.dense',
    summary: 'holes inside the extent stay within max(minHoles, extent >> holeShift)',
    restsOn: 'a compiled function is one contiguous run of code, pools and tables',
    recovers: 'data decoded as code, whose walk skips over bytes it never reaches',
    reads: ['readings', 'rom'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'not-dense',
  intrinsic: true,
  check(r, v) {
    if (isDense(r, v.profile)) return undefined;
    return `not dense: holes inside its extent (${r.holeBytes} bytes in ${r.end - r.entry})`;
  },
});
