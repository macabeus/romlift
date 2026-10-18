// A scratch directory for a command that writes a tree only to check it (`verify --assemble`, `verify --link`,
// architecture §2.1: "a temporary directory only"): a fresh directory under os.tmpdir(), never the working
// directory, removed afterwards whatever the callback does. Creating it can fail (E_IO_WRITE); removing it is
// best effort, because the check's verdict is already known by then.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnostic } from '../foundation/diagnostics/diagnostic.ts';
import { ShellCodes } from './codes.ts';
import type { IoResult } from './fs.ts';
import { errorReason } from './fs.ts';

/** Runs `fn` in a fresh directory `<os.tmpdir()>/<prefix>XXXXXX` and removes the directory after it settles. */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<IoResult<T>> {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), prefix));
  } catch (error) {
    const reason = errorReason(error);
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create a temporary directory under ${tmpdir()}: ${reason}`, { path: tmpdir() }) };
  }
  try {
    return { ok: true, value: await fn(dir) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
