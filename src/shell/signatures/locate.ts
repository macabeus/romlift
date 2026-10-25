// Where the built signature files are (architecture §7.1, D40): `$ROMLIFT_SIGNATURES` when it names a directory, else
// `<packageRoot>/signatures/`, whose `<library>.json` files `romlift signatures build` writes (gitignored; the committed
// specs live in its `specs/` subdirectory, which is not read). Every `*.json` regular file of the directory is read and
// validated with parseSignatureFile; one that cannot be read, is not of schema 3 or repeats a library already read is
// skipped with W_SIGNATURE_FILE_SKIPPED, so a bad local file never stops `init`. No directory, or none holding a file,
// gives no file and no diagnostic: the caller decides, with signaturesAbsent (W_SIGNATURES_ABSENT; `signatures <rom>`
// and `init` proceed without signatures).
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { parseSignatureFile } from '../../core/signatures/schema.ts';
import type { SignatureFile } from '../../core/signatures/schema.ts';
import { ShellCodes } from '../codes.ts';
import { errorReason, isDirectory, listDir, readBytes } from '../fs.ts';
import type { IoResult } from '../fs.ts';

/** The environment variable naming a directory of built signature files. */
export const SIGNATURES_ENV = 'ROMLIFT_SIGNATURES';

export interface LocateSignaturesOptions {
  /** The package whose `signatures/` directory is the default. */
  readonly packageRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** What a relative `$ROMLIFT_SIGNATURES` resolves against; default the package root. */
  readonly cwd?: string;
}

export interface LocatedSignatures {
  /** The directory read. */
  readonly dir: string;
  /** The valid files, one per library, sorted by library (code unit). */
  readonly files: readonly SignatureFile[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The signature file at `path`, validated (E_IO_READ, E_SIGNATURE_FILE_INVALID). */
export async function readSignatureFile(path: string): Promise<IoResult<SignatureFile>> {
  const read = await readBytes(path);
  if (!read.ok) return read;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8').decode(read.value));
  } catch (error) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_FILE_INVALID', `${path} is not JSON: ${errorReason(error)}`, { path }) };
  }
  const parsed = parseSignatureFile(json);
  if (!parsed.ok) return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_FILE_INVALID', `${path}: ${parsed.error}`, { path }) };
  return { ok: true, value: parsed.value };
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** The built signature files of `$ROMLIFT_SIGNATURES` or `<packageRoot>/signatures/`. */
export async function locateSignatures(options: LocateSignaturesOptions): Promise<LocatedSignatures> {
  const named = options.env[SIGNATURES_ENV];
  const dir = named !== undefined && named !== '' ? resolve(options.cwd ?? options.packageRoot, named) : join(options.packageRoot, 'signatures');
  const present = await isDirectory(dir);
  if (!present.ok) return { dir, files: [], diagnostics: [present.diagnostic] };
  if (!present.value) return { dir, files: [], diagnostics: [] };
  const names = await listDir(dir);
  if (!names.ok) return { dir, files: [], diagnostics: [names.diagnostic] };
  const diagnostics: Diagnostic[] = [];
  const byLibrary = new Map<string, SignatureFile>();
  for (const name of names.value) {
    const path = join(dir, name);
    if (!name.endsWith('.json') || !(await isRegularFile(path))) continue;
    const read = await readSignatureFile(path);
    if (!read.ok) {
      diagnostics.push(diagnostic(ShellCodes, 'W_SIGNATURE_FILE_SKIPPED', `${read.diagnostic.message}; skipped`, { path }));
      continue;
    }
    if (byLibrary.has(read.value.library)) {
      diagnostics.push(diagnostic(ShellCodes, 'W_SIGNATURE_FILE_SKIPPED', `${path} is a second file of library ${read.value.library}; skipped`, { path }));
      continue;
    }
    byLibrary.set(read.value.library, read.value);
  }
  const libraries = Array.from(byLibrary.keys()).sort(compareCodeUnits);
  const files = libraries.flatMap((library) => {
    const file = byLibrary.get(library);
    return file === undefined ? [] : [file];
  });
  return { dir, files, diagnostics };
}

/**
 * W_SIGNATURES_ABSENT when the locator found no valid file (the directory it read is named), else undefined: what a
 * caller that proceeds without signatures reports (`signatures <rom>`, `init`).
 */
export function signaturesAbsent(located: LocatedSignatures): Diagnostic | undefined {
  if (located.files.length > 0) return undefined;
  return diagnostic(ShellCodes, 'W_SIGNATURES_ABSENT', `no built signature file in ${located.dir}; build them with \`romlift signatures build <spec>\` (or set ${SIGNATURES_ENV})`, { path: located.dir });
}
