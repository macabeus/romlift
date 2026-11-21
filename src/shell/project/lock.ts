// The project lock (architecture §6.4 step 4, D17): `.romlift/lock`, created with O_EXCL and holding the
// pid and host of its run, so two runs never plan and apply against one project at once. A second run
// fails with E_PROJECT_LOCKED; a lock whose pid is gone on this host is taken over with W_STALE_LOCK; the
// lock is always released, also when the locked function throws.
import { randomBytes } from 'node:crypto';
import { link, mkdir, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { LOCK_PATH, ROMLIFT_DIR } from '../../core/write-plan/types.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ShellCodes } from '../codes.ts';
import { errnoOf, errorReason, readTextIfPresent } from '../fs.ts';
import { onDisk } from './disk-state.ts';

export type LockOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** What a lock file holds. */
export interface LockHolder {
  readonly pid: number;
  readonly host: string;
}

/** The lock text of a holder: canonical JSON and a newline. */
export function lockText(holder: LockHolder): string {
  return `${JSON.stringify({ host: holder.host, pid: holder.pid })}\n`;
}

/** The holder a lock text names, or undefined when it names none (an empty or damaged lock). */
export function parseLock(text: string): LockHolder | undefined {
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null) return undefined;
    const { pid, host } = json as { readonly pid?: unknown; readonly host?: unknown };
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && typeof host === 'string'
      ? { pid, host }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Whether process `pid` exists on this host (a process of another user counts). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

type Attempt =
  | { readonly kind: 'taken' }
  | { readonly kind: 'exists' }
  | { readonly kind: 'failed'; readonly diagnostic: Diagnostic };

/** Creates the lock with O_EXCL holding `text`. */
async function create(file: string, text: string): Promise<Attempt> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(file, 'wx');
  } catch (error) {
    if (errnoOf(error) === 'EEXIST') return { kind: 'exists' };
    return {
      kind: 'failed',
      diagnostic: diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${file}: ${errorReason(error)}`, { path: file }),
    };
  }
  try {
    await handle.writeFile(text);
    await handle.sync();
    return { kind: 'taken' };
  } catch (error) {
    await handle.close().catch(() => undefined);
    handle = undefined;
    await unlink(file).catch(() => undefined);
    return {
      kind: 'failed',
      diagnostic: diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${file}: ${errorReason(error)}`, { path: file }),
    };
  } finally {
    await handle?.close();
  }
}

/** The lock's text, or undefined when it is gone or cannot be read (a removal or a release then does nothing). */
async function readText(file: string): Promise<string | undefined> {
  const read = await readTextIfPresent(file);
  return read.ok ? read.value : undefined;
}

function locked(file: string, why: string): Diagnostic {
  return diagnostic(ShellCodes, 'E_PROJECT_LOCKED', `${file} ${why}`, { path: file });
}

/**
 * Moves the stale lock `file` (whose text was `stale`) out of the way. Renaming is atomic, so of two runs
 * taking over at once only one moves it; when the moved file is not the stale one (another run had just
 * taken the lock over), it is put back and the takeover gives up. Exported only for its unit test, which drives
 * that race directly (test/unit/shell/project/lock.test.ts); no other module calls it.
 */
export async function removeStale(file: string, stale: string): Promise<boolean> {
  const aside = `${file}.${randomBytes(6).toString('hex')}.stale`;
  try {
    await rename(file, aside);
  } catch {
    return false;
  }
  const moved = await readText(aside);
  if (moved !== stale) {
    await link(aside, file).catch(() => undefined);
    await unlink(aside).catch(() => undefined);
    return false;
  }
  await unlink(aside).catch(() => undefined);
  return true;
}

type Acquired =
  | { readonly ok: true; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

async function acquire(file: string, text: string): Promise<Acquired> {
  const self = parseLock(text);
  const notes: Diagnostic[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const created = await create(file, text);
    if (created.kind === 'taken') return { ok: true, diagnostics: notes };
    if (created.kind === 'failed') return { ok: false, diagnostic: created.diagnostic };
    const held = await readText(file);
    // Released between our create and read, or unreadable (a directory there): try again, then E_PROJECT_LOCKED.
    if (held === undefined) continue;
    const holder = parseLock(held);
    if (holder === undefined) {
      return { ok: false, diagnostic: locked(file, 'holds no pid and host; if no romlift run is active, remove it') };
    }
    const who = `pid ${holder.pid} on ${holder.host}`;
    if (holder.host !== self?.host || processAlive(holder.pid)) {
      return { ok: false, diagnostic: locked(file, `is held by ${who}`) };
    }
    if (attempt > 0 || !(await removeStale(file, held))) {
      return { ok: false, diagnostic: locked(file, `is held by ${who}, which is gone, and another run took it over`) };
    }
    notes.push(
      diagnostic(ShellCodes, 'W_STALE_LOCK', `${file} was left by ${who}, which is gone; taken over`, { path: file }),
    );
  }
  return { ok: false, diagnostic: locked(file, 'could not be taken') };
}

/** Removes the lock when it is still ours; a failure leaves a lock the next run sees as stale. */
async function release(file: string, text: string): Promise<void> {
  if ((await readText(file)) === text) await unlink(file).catch(() => undefined);
}

/**
 * Runs `fn` holding `<dir>/.romlift/lock`. Refuses with E_PROJECT_LOCKED while another live run holds it
 * (or a lock names no holder, or one on another host, which this host cannot check); takes over a lock
 * whose process is gone on this host with W_STALE_LOCK. The lock is released when `fn` settles; when it
 * throws, the error propagates after the release.
 */
export async function withProjectLock<T>(dir: string, fn: () => Promise<T>): Promise<LockOutcome<T>> {
  try {
    await mkdir(join(dir, ROMLIFT_DIR), { recursive: true });
  } catch (error) {
    const path = join(dir, ROMLIFT_DIR);
    return {
      ok: false,
      diagnostics: [diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${path}: ${errorReason(error)}`, { path })],
    };
  }
  const file = onDisk(dir, LOCK_PATH);
  const text = lockText({ pid: process.pid, host: hostname() });
  const acquired = await acquire(file, text);
  if (!acquired.ok) return { ok: false, diagnostics: [acquired.diagnostic] };
  try {
    return { ok: true, value: await fn(), diagnostics: acquired.diagnostics };
  } finally {
    await release(file, text);
  }
}
