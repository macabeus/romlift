// Diagnostic codes raised by core/model (architecture §9.1, D45). Empty until their raisers land
// (p3-model): E_MODULE_BORDER, E_MODULE_ORDER, E_NAME_COLLISION, E_OVERRIDE_INVALID,
// W_CROSS_MODULE_SHORT_BRANCH.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ModelCodes = defineCodes({});

export type ModelCode = keyof typeof ModelCodes;
