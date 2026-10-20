// Diagnostic codes raised by core/config (architecture §6.5, §9.1, D45): the TOML parser, key checks,
// serializer, patch planner and decomp.yaml renderer. Empty until their raisers land (p4-config, D74).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ConfigCodes = defineCodes({});

export type ConfigCode = keyof typeof ConfigCodes;
