// Diagnostic codes raised by the shell (architecture §9.1); outside the core union.
import { defineCodes } from '../foundation/diagnostics/diagnostic.ts';

export const ShellCodes = defineCodes({
  E_IO_READ: { severity: 'error', meaning: 'a file or directory could not be read' },
  E_IO_WRITE: { severity: 'error', meaning: 'a file could not be written' },
});

export type ShellCode = keyof typeof ShellCodes;
