// Diagnostic codes raised by core/write-plan (architecture §9.1, D45); their raiser is plan-writes.ts.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const WritePlanCodes = defineCodes({
  E_PATH_NOT_OWNED: {
    severity: 'error',
    meaning: 'a generated file would overwrite a file romlift does not own, outside the generated roots',
  },
  E_STALE_EDIT: { severity: 'error', meaning: 'a reconciled file changed since its edits were planned' },
  W_UNOWNED_FILE: {
    severity: 'warning',
    meaning: 'a file under a generated root is neither in the tree nor in the manifest; it is left in place',
  },
});

export type WritePlanCode = keyof typeof WritePlanCodes;
