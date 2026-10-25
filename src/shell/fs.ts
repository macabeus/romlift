// The file primitives every shell module uses: listing a directory in code-unit order (the only
// readdir in the shell, architecture §2), reading bytes, and writing a file atomically. Failures are
// returned as E_IO_READ or E_IO_WRITE diagnostics, never thrown.
import { randomBytes } from 'node:crypto';
import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { closeSync, openSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { diagnostic } from '../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../foundation/util/sorted.ts';
import { ShellCodes } from './codes.ts';
import type { ShellCode } from './codes.ts';

export type IoResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: Diagnostic<ShellCode> };

/** Bytes gathered from a stream of string chunks before one write call. */
const WRITE_BATCH = 1 << 20;

/** An error's errno code (ENOENT, EEXIST, ...), or undefined. */
export function errnoOf(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

/**
 * Whether a failure to reach `path` means nothing is there: it is absent (ENOENT), a component of its path is no
 * directory (ENOTDIR), or a symbolic link on it loops (ELOOP, a link to nothing). The one reading of absence in the
 * shell (architecture-r2-4); any other failure (a permission, an I/O error) is E_IO_READ, never read as absent.
 */
export function isAbsentError(error: unknown): boolean {
  const code = errnoOf(error);
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}

/** The error's message, led by its code once (Node's own message often starts with it): what every shell diagnostic quotes. */
export function errorReason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === undefined || error.message.startsWith(`${code}:`) ? error.message : `${code}: ${error.message}`;
  }
  return String(error);
}

function failure(code: ShellCode, path: string, what: string, error: unknown): IoResult<never> {
  return { ok: false, diagnostic: diagnostic(ShellCodes, code, `${what} ${path}: ${errorReason(error)}`, { path }) };
}

/** The names in directory `path`, sorted by UTF-16 code unit. */
export async function listDir(path: string): Promise<IoResult<readonly string[]>> {
  try {
    const names = await readdir(path);
    return { ok: true, value: names.sort(compareCodeUnits) };
  } catch (error) {
    return failure('E_IO_READ', path, 'cannot list', error);
  }
}

/**
 * Whether `path` is a directory: false when nothing is there (isAbsentError) or it is another kind of file; any other
 * failure (a permission, an I/O error) is E_IO_READ, never read as absent.
 */
export async function isDirectory(path: string): Promise<IoResult<boolean>> {
  try {
    return { ok: true, value: (await stat(path)).isDirectory() };
  } catch (error) {
    if (isAbsentError(error)) return { ok: true, value: false };
    return failure('E_IO_READ', path, 'cannot examine', error);
  }
}

/**
 * Whether `path` is a regular file (a link to one counts): false when nothing is there (isAbsentError) or it is
 * another kind of file; any other failure is E_IO_READ, never read as absent (architecture-6).
 */
export async function isRegularFile(path: string): Promise<IoResult<boolean>> {
  try {
    return { ok: true, value: (await stat(path)).isFile() };
  } catch (error) {
    if (isAbsentError(error)) return { ok: true, value: false };
    return failure('E_IO_READ', path, 'cannot examine', error);
  }
}

/** The text of file `path` as UTF-8. */
export async function readText(path: string): Promise<IoResult<string>> {
  const read = await readBytes(path);
  return read.ok ? { ok: true, value: new TextDecoder('utf-8').decode(read.value) } : read;
}

/** What readJson's caller decodes the parsed JSON with: the value, or why it is refused. */
export type JsonDecode<T> = (json: unknown) => { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/**
 * The JSON file at `path` read, parsed and decoded with `decode`: E_IO_READ when it cannot be read, `invalid` (the
 * caller's code) when it is not JSON (`<path> is not JSON: …`) or `decode` refuses it (`<path>: <why>`).
 */
export async function readJson<T>(path: string, decode: JsonDecode<T>, invalid: ShellCode): Promise<IoResult<T>> {
  const text = await readText(path);
  if (!text.ok) return text;
  let json: unknown;
  try {
    json = JSON.parse(text.value);
  } catch (error) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, invalid, `${path} is not JSON: ${errorReason(error)}`, { path }) };
  }
  const decoded = decode(json);
  return decoded.ok ? decoded : { ok: false, diagnostic: diagnostic(ShellCodes, invalid, `${path}: ${decoded.error}`, { path }) };
}

/** The bytes of file `path`. */
export async function readBytes(path: string): Promise<IoResult<Uint8Array>> {
  try {
    const buffer = await readFile(path);
    return { ok: true, value: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
  } catch (error) {
    return failure('E_IO_READ', path, 'cannot read', error);
  }
}

export interface AtomicWriteOptions {
  /**
   * Flush the temporary file to disk before the rename (fsync), so the new content survives a crash; default
   * true. applyWrites passes false for a generated file, which the next run compares with the tree and
   * rewrites when it differs, so a crash can cost it nothing but the rewrite (architecture §6.4).
   */
  readonly durable?: boolean;
  /**
   * When `path` does not exist, create it in place (`O_EXCL`) instead of through a temporary file and a rename;
   * only without `durable`. There is no old file a reader could lose, and a crash part-way leaves a file the next
   * run rewrites; an existing file still goes through the temporary file.
   */
  readonly inPlaceWhenAbsent?: boolean;
  /** The file's permission bits (e.g. 0o755 for an executable), set on the file before it takes `path`'s place; default the umask's. */
  readonly mode?: number;
}

type Data = string | Uint8Array | Iterable<string>;

/** Writes `data` through an open handle, a stream of chunks in batches of WRITE_BATCH. */
async function writeData(handle: FileHandle, data: Data): Promise<void> {
  if (typeof data === 'string' || data instanceof Uint8Array) {
    await handle.writeFile(data);
    return;
  }
  let batch = '';
  for (const chunk of data) {
    batch += chunk;
    if (batch.length >= WRITE_BATCH) {
      await handle.writeFile(batch);
      batch = '';
    }
  }
  if (batch.length > 0) await handle.writeFile(batch);
}

/**
 * Creates `path` with `data` when it does not exist: true when written, false when it exists (nothing touched).
 * Synchronous on purpose: a fresh tree is thousands of small files, and the synchronous calls skip the thread
 * pool and its promises (measured on pokeemerald's 19,121 files: 1.6 s against 2.4 s CPU).
 */
function createInPlace(path: string, data: Data): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    if (typeof data === 'string' || data instanceof Uint8Array) writeAll(fd, data);
    else {
      let batch = '';
      for (const chunk of data) {
        batch += chunk;
        if (batch.length >= WRITE_BATCH) {
          writeAll(fd, batch);
          batch = '';
        }
      }
      if (batch.length > 0) writeAll(fd, batch);
    }
  } catch (error) {
    closeSync(fd);
    rmSync(path, { force: true });
    throw error;
  }
  closeSync(fd);
  return true;
}

/** Writes all of `data` at the descriptor's position. */
function writeAll(fd: number, data: string | Uint8Array): void {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  for (let done = 0; done < bytes.length; ) done += writeSync(fd, bytes, done, bytes.length - done);
}

/**
 * Replaces file `path` with `data`: writes a temporary file in the same directory, flushes it to disk
 * (unless `durable` is false), then renames it over `path`, so a reader sees the old file or the new one,
 * never a partial one. The temporary file is removed when any step fails. With `inPlaceWhenAbsent` and not
 * `durable`, a path that does not exist yet is created in place.
 */
export async function atomicWrite(path: string, data: Data, options: AtomicWriteOptions = {}): Promise<IoResult<void>> {
  const durable = options.durable !== false;
  if (!durable && options.inPlaceWhenAbsent === true && options.mode === undefined) {
    try {
      if (createInPlace(path, data)) return { ok: true, value: undefined };
    } catch (error) {
      return failure('E_IO_WRITE', path, 'cannot write', error);
    }
  }
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(temp, 'wx');
    try {
      await writeData(handle, data);
      if (options.mode !== undefined) await handle.chmod(options.mode);
      if (durable) await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
    return { ok: true, value: undefined };
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    return failure('E_IO_WRITE', path, 'cannot write', error);
  }
}
