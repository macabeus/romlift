// Diagnostic codes raised by core/verify (architecture §6.4, §9.1, D45, D49): the four self-checks and the
// paths check of the same pass. Every one is an error: a failed self-check writes nothing (exit 3).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const VerifyCodes = defineCodes({
  E_SELF_CHECK_TILING: {
    severity: 'error',
    meaning: 'the model does not tile the ROM: a gap or overlap between items, chunks or modules (tiling.ts)',
  },
  E_SELF_CHECK_REENCODE: {
    severity: 'error',
    meaning: 'an instruction item would not print as a mnemonic that assembles back to its bytes (reencode.ts)',
  },
  E_MODULE_SIZE: {
    severity: 'error',
    meaning: "a module's items do not add up to its span (module-size.ts)",
  },
  E_SELF_CHECK_TEXT: {
    severity: 'error',
    meaning: 'an emitted file, parsed back and laid out, differs from the ROM or its padding, or a file is missing (text-layout.ts)',
  },
  E_PATH_CASE_COLLISION: {
    severity: 'error',
    meaning: 'two emitted paths are the same file, exactly or on a case-insensitive file system (paths.ts)',
  },
});

export type VerifyCode = keyof typeof VerifyCodes;
