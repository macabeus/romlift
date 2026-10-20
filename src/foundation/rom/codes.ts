// Diagnostic codes raised by foundation/rom (architecture §9.1). The SHA-1 mismatch of a project's ROM is core/config's
// (rom-sha1.ts, D75 h): foundation holds no project knowledge.
import { defineCodes } from '../diagnostics/diagnostic.ts';

export const RomCodes = defineCodes({
  E_ROM_NOT_GBA: {
    severity: 'error',
    meaning:
      'the image is not a GBA cartridge: shorter than its 192-byte header, larger than 32 MiB, or its fixed byte or header complement is wrong',
  },
});

export type RomCode = keyof typeof RomCodes;
