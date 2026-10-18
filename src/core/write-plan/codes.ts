// Diagnostic codes raised by core/write-plan (architecture §9.1, D45). Empty until their raiser,
// plan-writes.ts, lands (p3-write-plan): E_PATH_NOT_OWNED, E_STALE_EDIT, W_UNOWNED_FILE.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const WritePlanCodes = defineCodes({});

export type WritePlanCode = keyof typeof WritePlanCodes;
