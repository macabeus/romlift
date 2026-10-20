// The disk snapshot planWrites reads (architecture §6.4 step 3): the sha1 of every file under the generated
// roots and of every given path ('absent' when there is none), and the project's manifest and journal.
// Mechanical: the shell lists, reads and hashes; what the digests mean is planWrites'. Directories are
// listed only through shell/fs.ts's listDir (architecture §2).
import type { Stats } from 'node:fs';
import { lstat, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { decodeJournal } from '../../core/write-plan/journal.ts';
import type { Journal } from '../../core/write-plan/journal.ts';
import { decodeManifest, isProjectPath } from '../../core/write-plan/manifest.ts';
import { GENERATED_ROOTS, JOURNAL_PATH, MANIFEST_PATH } from '../../core/write-plan/types.ts';
import type { Manifest } from '../../core/write-plan/types.ts';
import { ShellCodes } from '../codes.ts';
import { errnoOf, errorReason, listDir } from '../fs.ts';
import type { IoResult } from '../fs.ts';
import { sha1Of } from '../hash.ts';

/** A project path ('/'-separated) under `dir`. */
export function onDisk(dir: string, path: string): string {
  return join(dir, ...path.split('/'));
}

function ioError(code: 'E_IO_READ' | 'E_IO_WRITE', path: string, message: string): IoResult<never> {
  return { ok: false, diagnostic: diagnostic(ShellCodes, code, message, { path }) };
}

/** The text of a project file, or null when it does not exist. */
async function readOptionalText(dir: string, path: string): Promise<IoResult<string | null>> {
  const file = onDisk(dir, path);
  try {
    return { ok: true, value: await readFile(file, 'utf8') };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return { ok: true, value: null };
    return ioError('E_IO_READ', file, `cannot read ${file}: ${errorReason(error)}`);
  }
}

/** The sha1 of a project file's bytes, or 'absent' when nothing is there. A directory is an E_IO_READ. */
async function digestOf(dir: string, path: string): Promise<IoResult<string>> {
  const file = onDisk(dir, path);
  try {
    return { ok: true, value: sha1Of(await readFile(file)) };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return { ok: true, value: 'absent' };
    return ioError('E_IO_READ', file, `cannot read ${file}: ${errorReason(error)}`);
  }
}

/** Every file below the project directory `path` (no trailing '/'), as project paths; none when it is absent. */
async function filesUnder(dir: string, path: string, out: string[]): Promise<IoResult<void>> {
  let stat: Stats;
  try {
    stat = await lstat(onDisk(dir, path));
  } catch (error) {
    if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return { ok: true, value: undefined };
    return ioError('E_IO_READ', onDisk(dir, path), `cannot stat ${onDisk(dir, path)}: ${errorReason(error)}`);
  }
  if (!stat.isDirectory()) {
    out.push(path);
    return { ok: true, value: undefined };
  }
  const names = await listDir(onDisk(dir, path));
  if (!names.ok) return names;
  for (const name of names.value) {
    const below = await filesUnder(dir, `${path}/${name}`, out);
    if (!below.ok) return below;
  }
  return { ok: true, value: undefined };
}

/** Whether two project paths are one directory entry on disk (a case-insensitive file system's two spellings). */
async function oneFile(dir: string, a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([lstat(onDisk(dir, a)), lstat(onDisk(dir, b))]);
    return x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}

/**
 * The disk snapshot of `dir` for planWrites: the sha1 of every file under GENERATED_ROOTS and of every path
 * in `paths` (the tree's paths, and the manifest's), 'absent' for a path with no file. Keys in code-unit
 * order. A file the walk of the roots finds under another case than a path of `paths` that is the same file (a
 * case-insensitive file system) is listed once, under the spelling `paths` gives. A symbolic link is hashed
 * through to its target; a directory where a file is expected (a link to one included) is E_IO_READ.
 */
export async function readDiskState(dir: string, paths: Iterable<string>): Promise<IoResult<ReadonlyMap<string, string | 'absent'>>> {
  const wanted = new Set<string>();
  for (const path of paths) {
    if (!isProjectPath(path)) return ioError('E_IO_READ', path, `${JSON.stringify(path)} is not a project path`);
    wanted.add(path);
  }
  const given = new Map<string, string>();
  for (const path of wanted) given.set(foldPath(path), path);
  for (const root of GENERATED_ROOTS) {
    const found: string[] = [];
    const listed = await filesUnder(dir, root.endsWith('/') ? root.slice(0, -1) : root, found);
    if (!listed.ok) return listed;
    for (const path of found) {
      const spelled = given.get(foldPath(path));
      if (spelled !== undefined && spelled !== path && !wanted.has(path) && (await oneFile(dir, spelled, path))) continue;
      wanted.add(path);
    }
  }
  const out = new Map<string, string | 'absent'>();
  for (const path of [...wanted].sort(compareCodeUnits)) {
    const digest = await digestOf(dir, path);
    if (!digest.ok) return digest;
    out.set(path, digest.value);
  }
  return { ok: true, value: out };
}

/** `.romlift/manifest.json`, or null when there is none; a file that is not a manifest is E_IO_READ. */
export async function readManifest(dir: string): Promise<IoResult<Manifest | null>> {
  const text = await readOptionalText(dir, MANIFEST_PATH);
  if (!text.ok || text.value === null) return text.ok ? { ok: true, value: null } : text;
  const decoded = decodeManifest(text.value);
  if (decoded.ok) return { ok: true, value: decoded.manifest };
  const file = onDisk(dir, MANIFEST_PATH);
  return ioError('E_IO_READ', file, `${file} is not a romlift manifest (${decoded.error}); remove it to plan as if there were none`);
}

/** `.romlift/journal.json`, the journal of an interrupted run, or null; a damaged one is E_IO_READ. */
export async function readJournal(dir: string): Promise<IoResult<Journal | null>> {
  const text = await readOptionalText(dir, JOURNAL_PATH);
  if (!text.ok || text.value === null) return text.ok ? { ok: true, value: null } : text;
  const decoded = decodeJournal(text.value);
  if (decoded.ok) return { ok: true, value: decoded.journal };
  const file = onDisk(dir, JOURNAL_PATH);
  return ioError('E_IO_READ', file, `${file} is not a romlift journal (${decoded.error})`);
}

/** Those of `paths` whose file exists with its owner's executable bit, for WritePlanInputs.executables. */
export async function readExecutables(dir: string, paths: Iterable<string>): Promise<ReadonlySet<string>> {
  const out = new Set<string>();
  for (const path of paths) {
    try {
      if (((await stat(onDisk(dir, path))).mode & 0o100) !== 0) out.add(path);
    } catch {
      // Absent or unreadable: planWrites writes it, or the snapshot reports it.
    }
  }
  return out;
}

/** The current text of each reconciled path, for WritePlanInputs.reconciledTexts; an absent file has none. */
export async function readReconciledTexts(dir: string, paths: Iterable<string>): Promise<IoResult<ReadonlyMap<string, string>>> {
  const out = new Map<string, string>();
  for (const path of [...paths].sort(compareCodeUnits)) {
    if (!isProjectPath(path)) return ioError('E_IO_READ', path, `${JSON.stringify(path)} is not a project path`);
    const text = await readOptionalText(dir, path);
    if (!text.ok) return text;
    if (text.value !== null) out.set(path, text.value);
  }
  return { ok: true, value: out };
}
