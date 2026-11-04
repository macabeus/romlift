// The ROM a project was made from (architecture §6.5, §9.1, D75 h): romlift.toml's `[rom] sha1` names it, and every
// command that reads a project (generate, update, and the project mode of model, verify and explain)
// refuses another ROM before any analysis, since a tree emitted from it would not rebuild the recorded image. A
// question about the config, so core/config's, not foundation/rom's.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { ROMLIFT_CONFIG_FILE } from '../../foundation/util/project-files.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';
import type { RomliftConfig } from './schema.ts';

/** E_ROM_SHA1_MISMATCH when `rom` is not the ROM `config` records in `[rom] sha1` (compared case-insensitively); empty otherwise. */
export function romSha1Problems(rom: Pick<Rom, 'sha1'>, config: Pick<RomliftConfig, 'rom'>): readonly Diagnostic<ConfigCode>[] {
  const expected = config.rom.sha1;
  if (rom.sha1.toLowerCase() === expected.toLowerCase()) return [];
  const message = `the ROM has SHA-1 ${rom.sha1}, but ${ROMLIFT_CONFIG_FILE} records ${expected} in [rom] sha1: it is another ROM`;
  return [diagnostic(ConfigCodes, 'E_ROM_SHA1_MISMATCH', message, { path: ROMLIFT_CONFIG_FILE })];
}
