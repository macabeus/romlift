// Diagnostic codes raised by foundation/rom (architecture §9.1). The SHA-1 mismatch code landed with
// its first raiser in phase 4 (expected-sha1.ts, p4-workflows; D45).
import { defineCodes } from '../diagnostics/diagnostic.ts';

export const RomCodes = defineCodes({
  E_ROM_NOT_GBA: {
    severity: 'error',
    meaning:
      'the image is not a GBA cartridge: shorter than its 192-byte header, larger than 32 MiB, or its fixed byte or header complement is wrong',
  },
  E_ROM_SHA1_MISMATCH: {
    severity: 'error',
    meaning: "the ROM's SHA-1 is not the one the project's romlift.toml records in [rom] sha1, so it is another ROM",
  },
});

export type RomCode = keyof typeof RomCodes;
