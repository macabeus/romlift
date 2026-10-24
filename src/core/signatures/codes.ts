// Diagnostic codes raised by core/signatures (architecture §7.2, §9.1, D45): the matcher's (match.ts, rules/) and the
// overlap resolution's (resolve.ts). The builder's codes (extract.ts, p6-signatures-build) land with their raiser.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const SignatureCodes = defineCodes({
  W_SIGNATURE_CONSTANT: {
    severity: 'warning',
    meaning: 'a member both placed neighbours pin is placed although a word or two differ from the reference: the game constants it was given (sig.pinned-both-sides)',
  },
  W_SIGNATURE_POINTERS: {
    severity: 'warning',
    meaning: 'a pointer table fits but a word that names a placed function holds another address; it is not placed',
  },
  W_SIGNATURE_AMBIGUOUS: {
    severity: 'warning',
    meaning: 'a member fits at several places and no neighbour settles which; it is not placed',
  },
  W_SIGNATURE_DROPPED: {
    severity: 'warning',
    meaning: 'placements that overlap a version that placed more, or a region that interleaves with a larger one, are dropped',
  },
});

export type SignatureCode = keyof typeof SignatureCodes;
