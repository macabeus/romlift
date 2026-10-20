// Applies a write plan to a project directory (architecture §6.4 step 4, D17), mechanically: the journal
// first, each op through a temporary file and a rename, the manifest last, then the journal is removed. Each
// write and edit first gives the components of its path that exist under another case the op's spelling
// (spelling.ts respell: a case-only rename of a directory on a case-insensitive file system). The
// journal, the manifest, edits and scaffold files are flushed to disk before their rename; generated files are
// not, and one whose path does not exist yet is created in place (durableOp).
// Every decision is planWrites'; a plan with an error diagnostic is refused before anything is touched.
// The caller holds the project lock (withProjectLock, lock.ts) around the snapshot, the plan and this.
//
// Recovery: a run that stops part-way (a crash, a full disk) leaves `.romlift/journal.json` and the old
// manifest. The next run reads both (readJournal, readManifest in disk-state.ts) into planWrites, which
// treats the journal's paths as owned and an edit it shows done as done, so that run converges to the same
// tree and manifest as an uninterrupted one. A case rename the crash cut between its two renames is part of that
// recovery (architecture-r2-4): before it writes its own journal, applyWrites reads the one it finds and puts each
// entry left under a case rename's temporary name back under its old name (spelling.ts restoreCaseRenames), and its
// ops rename it again. A command calls restoreCaseRenames itself before it snapshots the disk, so the plan sees the
// tree as the interrupted op found it; the call here makes sure no temporary name outlives a run either way.
import { mkdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { encodeJournal, journalOf } from '../../core/write-plan/journal.ts';
import { encodeManifest, isProjectPath } from '../../core/write-plan/manifest.ts';
import { planHasErrors } from '../../core/write-plan/plan-writes.ts';
import { JOURNAL_PATH, MANIFEST_PATH, ROMLIFT_DIR } from '../../core/write-plan/types.ts';
import type { WriteOp, WritePlan } from '../../core/write-plan/types.ts';
import { ShellCodes } from '../codes.ts';
import { atomicWrite, errnoOf, errorReason } from '../fs.ts';
import { onDisk, readJournal } from './disk-state.ts';
import { respell, restoreCaseRenames } from './spelling.ts';
import type { Listings } from './spelling.ts';

export interface ApplyResult {
  /** Every op, the manifest and the journal's removal succeeded. */
  readonly ok: boolean;
  /** The ops that changed a file (writes, edits and deletes; keeps are not counted) before it stopped. */
  readonly applied: number;
  /** The plan's errors when it was refused, or the E_IO_WRITE that stopped it. */
  readonly diagnostics: readonly Diagnostic[];
}

function writeError(path: string, error: unknown): Diagnostic {
  const reason = errorReason(error);
  return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${path}: ${reason}`, { path });
}

/** Removes `file`; a file already gone is fine. */
async function removeFile(file: string): Promise<Diagnostic | undefined> {
  try {
    await unlink(file);
    return undefined;
  } catch (error) {
    return errnoOf(error) === 'ENOENT' ? undefined : writeError(file, error);
  }
}

/** Removes the empty directories from `file`'s parent up to, not including, `dir`. */
async function pruneEmptyParents(dir: string, file: string): Promise<void> {
  for (let at = dirname(file); relative(dir, at) !== '' && !relative(dir, at).startsWith('..'); at = dirname(at)) {
    try {
      await rmdir(at);
    } catch {
      return;
    }
  }
}

/** What one applyWrites call knows of the disk: the directories it made (each made once, not once per file) and the ones it listed. */
interface DiskKnown {
  readonly made: Set<string>;
  readonly listings: Listings;
}

async function writeText(file: string, text: string | Iterable<string>, durable: boolean, known: DiskKnown): Promise<Diagnostic | undefined> {
  const parent = dirname(file);
  if (!known.made.has(parent)) {
    try {
      await mkdir(parent, { recursive: true });
    } catch (error) {
      return writeError(file, error);
    }
    known.made.add(parent);
  }
  const written = await atomicWrite(file, text, { durable, inPlaceWhenAbsent: !durable });
  return written.ok ? undefined : written.diagnostic;
}

/**
 * Whether an op's file is flushed to disk before its rename: an edit of a user's file and a scaffold file
 * (written only when absent, so a file a crash left empty would stay empty) are; a generated file is not, because
 * the next run snapshots every generated path's sha1 and rewrites a file whose content differs from the tree,
 * the journal naming it owned. Measured on fe7j's 9,346 files, the flushes cost 5.1 s of the 12.6 s CPU of
 * generate and its write.
 */
export function durableOp(op: Extract<WriteOp, { readonly op: 'write' | 'edit' }>): boolean {
  return op.op === 'edit' || op.writer === 'scaffold' || op.writer === 'c-stub';
}

async function applyOp(dir: string, op: WriteOp, known: DiskKnown): Promise<Diagnostic | undefined> {
  const file = onDisk(dir, op.path);
  switch (op.op) {
    case 'write':
    case 'edit':
      return (await respell(dir, op.path, known.listings)) ?? writeText(file, op.text, durableOp(op), known);
    case 'delete': {
      const failed = await removeFile(file);
      if (failed === undefined) await pruneEmptyParents(dir, file);
      // A pruned directory must be made again by a later write, and is listed again.
      known.made.clear();
      known.listings.clear();
      return failed;
    }
    case 'keep':
      return undefined;
  }
}

/**
 * Applies `plan` to the project at `dir`: refuses it when it holds an error diagnostic (nothing is touched);
 * otherwise finishes the case renames the journal of an interrupted run shows half done (restoreCaseRenames; a
 * journal that cannot be read is E_IO_READ, and no op is applied), writes `.romlift/journal.json`, applies the
 * ops in plan order (each write and edit through a temporary file and a rename, each delete removing the file and
 * the directories it leaves empty), writes `.romlift/manifest.json` through a temporary file and a rename, and
 * removes the journal. The first failure stops it with E_IO_WRITE and leaves the journal for the next run.
 */
export async function applyWrites(dir: string, plan: WritePlan): Promise<ApplyResult> {
  if (planHasErrors(plan)) return { ok: false, applied: 0, diagnostics: plan.diagnostics.filter((d) => d.severity === 'error') };
  const unsafe = [...plan.ops.map((op) => op.path), ...Object.keys(plan.manifest.files)].find((path) => !isProjectPath(path));
  if (unsafe !== undefined) {
    const message = `refusing the plan: ${JSON.stringify(unsafe)} is not a project path`;
    return { ok: false, applied: 0, diagnostics: [diagnostic(ShellCodes, 'E_IO_WRITE', message, { path: unsafe })] };
  }
  try {
    await mkdir(join(dir, ROMLIFT_DIR), { recursive: true });
  } catch (error) {
    return { ok: false, applied: 0, diagnostics: [writeError(join(dir, ROMLIFT_DIR), error)] };
  }
  const interrupted = await readJournal(dir);
  if (!interrupted.ok) return { ok: false, applied: 0, diagnostics: [interrupted.diagnostic] };
  if (interrupted.value !== null) {
    const restored = await restoreCaseRenames(dir, interrupted.value);
    if (restored !== undefined) return { ok: false, applied: 0, diagnostics: [restored] };
  }
  const known: DiskKnown = { made: new Set(), listings: new Map() };
  const journal = await writeText(onDisk(dir, JOURNAL_PATH), encodeJournal(journalOf(plan.ops)), true, known);
  if (journal !== undefined) return { ok: false, applied: 0, diagnostics: [journal] };
  let applied = 0;
  for (const op of plan.ops) {
    const failed = await applyOp(dir, op, known);
    if (failed !== undefined) return { ok: false, applied, diagnostics: [failed] };
    if (op.op !== 'keep') applied++;
  }
  const manifest = await writeText(onDisk(dir, MANIFEST_PATH), encodeManifest(plan.manifest), true, known);
  if (manifest !== undefined) return { ok: false, applied, diagnostics: [manifest] };
  const cleared = await removeFile(onDisk(dir, JOURNAL_PATH));
  return cleared === undefined ? { ok: true, applied, diagnostics: [] } : { ok: false, applied, diagnostics: [cleared] };
}
