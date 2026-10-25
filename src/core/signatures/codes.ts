// Diagnostic codes raised by core/signatures (architecture §7.2, §9.1, D45). The builder's (extract.ts,
// p6-signatures-build) are below; W_SIGNATURE_CONSTANT and the other matcher codes land with their raiser,
// p6-signatures-match (D93), since a code lands with its first raiser.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const SignatureCodes = defineCodes({
  E_SIGNATURE_REFERENCES_MISMATCH: {
    severity: 'error',
    meaning: "the reference inputs given to the builder are not the spec's versions and references, in its order",
  },
  E_SIGNATURE_OBJECTS_UNMATCHED: { severity: 'error', meaning: "no .text placement of a reference's map matches the spec's object globs" },
  E_SIGNATURE_MEMBER_ID_INVALID: { severity: 'error', meaning: 'a symbol and its object give no member id (<symbol>@<object>.o)' },
  E_SIGNATURE_MEMBER_DUPLICATE: {
    severity: 'error',
    meaning: 'one reference links two members of one identity (the same member id, or the same global symbol)',
  },
  E_SIGNATURE_MEMBER_OUTSIDE_ROM: { severity: 'error', meaning: "a member's bytes run past the end of its reference ROM" },
  E_SIGNATURE_TABLE_UNPLACED: { severity: 'error', meaning: "a table's address lies in no input placement of its reference's map, so it has no object" },
  E_SIGNATURE_NAME_DUPLICATE: { severity: 'error', meaning: 'two members of one version have one display name; the spec must review one (reviewedNames)' },
  W_SIGNATURE_TABLE_MISSING: { severity: 'warning', meaning: "a table the spec names is no OBJECT symbol of the reference's ELF; skipped" },
  W_SIGNATURE_TABLE_UNSIZED: { severity: 'warning', meaning: 'a table has neither an ELF size nor a typed symbol after it; skipped' },
  W_SIGNATURE_MEMBER_DIFFERS: {
    severity: 'warning',
    meaning: "a later reference links a member of an earlier one whose bytes differ where both masks keep them; the earlier reference's bytes are kept",
  },
  W_SIGNATURE_REVIEWED_UNUSED: { severity: 'warning', meaning: "a reviewed name's member id is no member of any version" },
});

export type SignatureCode = keyof typeof SignatureCodes;
