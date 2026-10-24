// Diagnostic codes raised by core/signatures (architecture §7.2, §9.1, D45): W_SIGNATURE_CONSTANT and whatever the
// builder and the matcher raise. Empty until their raisers land (p6-signatures-build, then p6-signatures-match,
// D93), since a code lands with its first raiser.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const SignatureCodes = defineCodes({});

export type SignatureCode = keyof typeof SignatureCodes;
