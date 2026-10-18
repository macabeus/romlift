// The file primitives every shell module uses: listing a directory in code-unit order (the only
// readdir in the shell, architecture §2), reading bytes, and writing a file atomically. Failures are
// returned as E_IO_READ or E_IO_WRITE diagnostics, never thrown.
import { randomBytes } from 'node:crypto';
import { open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { diagnostic } from '../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../foundation/util/sorted.ts';
import { ShellCodes } from './codes.ts';
import type { ShellCode } from './codes.ts';

export type IoResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: Diagnostic<ShellCode> };

/** Bytes gathered from a stream of string chunks before one write call. */
const WRITE_BATCH = 1 << 20;

/** The error's message, led by its code once (Node's own message often starts with it). */
function reason(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === undefined || error.message.startsWith(`${code}:`) ? error.message : `${code}: ${error.message}`;
  }
  return String(error);
}

function failure(code: ShellCode, path: string, what: string, error: unknown): IoResult<never> {
  return { ok: false, diagnostic: diagnostic(ShellCodes, code, `${what} ${path}: ${reason(error)}`, { path }) };
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

/** The bytes of file `path`. */
export async function readBytes(path: string): Promise<IoResult<Uint8Array>> {
  try {
    const buffer = await readFile(path);
    return { ok: true, value: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
  } catch (error) {
    return failure('E_IO_READ', path, 'cannot read', error);
  }
}

/**
 * Replaces file `path` with `data`: writes a temporary file in the same directory, flushes it to disk,
 * then renames it over `path`, so a reader sees the old file or the new one, never a partial one.
 * The temporary file is removed when any step fails.
 */
export async function atomicWrite(path: string, data: string | Uint8Array | Iterable<string>): Promise<IoResult<void>> {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = await open(temp, 'wx');
    try {
      if (typeof data === 'string' || data instanceof Uint8Array) {
        await handle.writeFile(data);
      } else {
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
      await handle.sync();
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
