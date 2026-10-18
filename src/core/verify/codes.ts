// Diagnostic codes raised by core/verify (architecture §9.1, D45). Empty until their raisers land
// (p3-data-verify): E_SELF_CHECK_TILING, E_SELF_CHECK_REENCODE, E_MODULE_SIZE, E_SELF_CHECK_TEXT,
// E_PATH_CASE_COLLISION.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const VerifyCodes = defineCodes({});

export type VerifyCode = keyof typeof VerifyCodes;
