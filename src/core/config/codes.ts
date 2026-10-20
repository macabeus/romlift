// Diagnostic codes raised by core/config (architecture §6.5, §9.1, D45): the TOML parser and its key checks, the
// patch planner, the decomp.yaml reader and the check of a project's ROM against [rom] sha1 (rom-sha1.ts, D75 h).
// Each code landed with its first raiser (p4-config, D74).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ConfigCodes = defineCodes({
  E_TOML_PARSE: { severity: 'error', meaning: 'romlift.toml is not TOML (smol-toml refused it at a line and column)' },
  E_TOML_KEY_SPELLING: {
    severity: 'error',
    meaning: 'a [functions] or [symbols] key is not 0x followed by eight upper-case hex digits (0x08000470)',
  },
  E_DUPLICATE_ADDRESS: { severity: 'error', meaning: 'an address is listed twice in [functions] or in [symbols]' },
  E_TOML_SCHEMA: { severity: 'error', meaning: 'romlift.toml is TOML but not schema 1: an unknown key, a missing one or a wrong value' },
  E_UNKNOWN_COMPILER: { severity: 'error', meaning: '[build] compiler or a module\'s compiler names no registered build compiler (core/config/compilers.ts)' },
  E_ROM_SHA1_MISMATCH: { severity: 'error', meaning: 'the ROM is not the one the project\'s romlift.toml records in [rom] sha1' },
  E_TOML_PATCH_REFUSED: {
    severity: 'error',
    meaning: 'the patch planner cannot edit an entry line by line (a hand-restructured table, a block entry); paste the entries it prints',
  },
  E_DECOMP_YAML_INVALID: {
    severity: 'error',
    meaning: 'decomp.yaml does not meet the decomp_settings spec or has no valid tools.romlift block',
  },
});

export type ConfigCode = keyof typeof ConfigCodes;
