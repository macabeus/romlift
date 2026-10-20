// Diagnostic codes raised by the shell (architecture §9.1); outside the core union.
import { defineCodes } from '../foundation/diagnostics/diagnostic.ts';

export const ShellCodes = defineCodes({
  E_IO_READ: { severity: 'error', meaning: 'a file or directory could not be read' },
  E_IO_WRITE: { severity: 'error', meaning: 'a file could not be written' },
  E_TOOLCHAIN_MISSING: { severity: 'error', meaning: 'arm-none-eabi-as, -ld or -objcopy is not on the PATH' },
  E_TOOLCHAIN_FAILED: { severity: 'error', meaning: 'arm-none-eabi-as, -ld or -objcopy exited with an error' },
  E_PROJECT_LOCKED: { severity: 'error', meaning: 'another romlift run holds the project lock (.romlift/lock)' },
  W_STALE_LOCK: { severity: 'warning', meaning: 'a lock left by a process that is gone on this host was taken over' },
  E_PROJECT_NOT_FOUND: { severity: 'error', meaning: 'no decomp.yaml in the directory or any parent: not inside a romlift project' },
  E_DIR_NOT_EMPTY: {
    severity: 'error',
    meaning: 'init was given a directory that holds other files than the ROM, .git and dot-files and is not a romlift project, or a project whose romlift.toml or baserom.gba init would replace',
  },
  W_LOCKFILE_DEFERRED: {
    severity: 'warning',
    meaning: 'npm could not write package-lock.json (the registry is unreachable, npm is missing or it timed out); setup.sh writes it on its first run',
  },
});

export type ShellCode = keyof typeof ShellCodes;
