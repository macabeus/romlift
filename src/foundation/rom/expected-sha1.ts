// The ROM a project was made from (architecture §6.5, §9.1): romlift.toml's `[rom] sha1` names it, and every
// command that reads a project (generate, analyze --update, and the project mode of model, verify and explain)
// refuses another ROM before any analysis, since a tree emitted from it would not rebuild the recorded image.
import { diagnostic } from '../diagnostics/diagnostic.ts';
import type { Diagnostic } from '../diagnostics/diagnostic.ts';
import { RomCodes } from './codes.ts';
import type { RomCode } from './codes.ts';
import type { Rom } from './rom.ts';

/**
 * E_ROM_SHA1_MISMATCH when `rom` is not the ROM whose SHA-1 is `expected` (compared case-insensitively); `path` is
 * the file that records `expected` (romlift.toml). Empty when they agree.
 */
export function expectedSha1Problems(rom: Pick<Rom, 'sha1'>, expected: string, path: string): readonly Diagnostic<RomCode>[] {
  if (rom.sha1.toLowerCase() === expected.toLowerCase()) return [];
  return [diagnostic(RomCodes, 'E_ROM_SHA1_MISMATCH', `the ROM has SHA-1 ${rom.sha1}, but ${path} records ${expected} in [rom] sha1: it is another ROM`, { path })];
}
