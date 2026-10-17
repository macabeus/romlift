// valid.decodes (the PoC's whyInvalid()): the walk from the entry found instructions and stopped on no
// decode error (an undecodable halfword, a path leaving the ROM, a bl or a pool load past its end).
import { hexAddr } from '../../../../foundation/util/hex.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.decodes',
    summary: 'the walk from the entry decodes at least one instruction and hits no decode error',
    restsOn: 'every path of a compiled function decodes until it returns or jumps away',
    recovers: 'data and text decoded as code',
    reads: ['readings'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'decode-error',
  intrinsic: true,
  check(r) {
    if (r.insns.length === 0) return 'decodes to nothing';
    const error = r.errors[0];
    return error === undefined ? undefined : `decode error ${error.reason} at ${hexAddr(error.at)}`;
  },
});
