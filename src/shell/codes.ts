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
  W_LOCKFILE_DEFERRED: {
    severity: 'warning',
    meaning: 'npm could not write package-lock.json (the registry is unreachable, npm is missing or it timed out); setup.sh writes it on its first run',
  },
  // The signature builder and locator (shell/signatures, phase 6, architecture §7.1, §7.2).
  E_SIGNATURE_SPEC_INVALID: { severity: 'error', meaning: 'a signature spec is not JSON or not a spec (parseSignatureSpec refused it)' },
  E_SIGNATURE_DATASET_UNKNOWN: { severity: 'error', meaning: 'a spec reference names neither a dataset under bench/dataset/real nor a synthetic fixture' },
  E_SIGNATURE_DATASET_SEALED: { severity: 'error', meaning: 'a spec reference names a sealed held-out dataset, which is never signature data (D32)' },
  E_SIGNATURE_DATASET_INVALID: { severity: 'error', meaning: 'a reference dataset file lacks its rom, elf, map, sha1 or elfCommit' },
  E_SIGNATURE_REFERENCE_SHA1: { severity: 'error', meaning: "a reference ROM's SHA-1 is not the one its dataset records" },
  E_SIGNATURE_REFERENCE_INVALID: { severity: 'error', meaning: "a reference's ELF or map does not parse" },
  E_SIGNATURE_FILE_INVALID: { severity: 'error', meaning: 'a signature file is not JSON or not of schema 3 (parseSignatureFile refused it)' },
  W_SIGNATURE_FILE_SKIPPED: { severity: 'warning', meaning: 'a signature file the locator found could not be read or repeats a library; skipped' },
});

export type ShellCode = keyof typeof ShellCodes;
