// Writing a project (architecture §6.4 steps 3 and 4, D17, D49): what `init` and `generate` do with a plan once the
// workflow made it. A tree (a model's emission stream, plus init's scaffold) is planned against a directory's snapshot
// by planWrites and applied by applyWrites under the project lock; a plan that changes nothing is not applied at all,
// so no file, the manifest included, gets a new modification time (g4.generate-idempotent). `init`'s own files are
// written here too, exactly the ones its plan names (InitPlan.files and romCopy, architecture-a2-6): the ROM copied to
// its project path, each text file saved (shell/config/save.ts); the scaffold's executable files are written with
// their mode (planWrites' `executable` writes and `mode` ops, applyWrites). Mechanical: every decision is planWrites'
// or a workflow's.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { FileEntry } from '../../core/emit/tree.ts';
import type { InitFile } from '../../core/workflow/types.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { retainedPrefixes } from '../../core/model/paths.ts';
import { generatedEntries, outTreeEntriesOf, projectTreeEntries, reconciledTextsOf } from '../../core/workflow/generate.ts';
import { replacedProblems } from '../../core/workflow/init.ts';
import { planChangesNothing, projectPlanInputs } from '../../core/write-plan/project-plan.ts';
import type { GenerateResult } from '../../core/workflow/generate.ts';
import { planWrites } from '../../core/write-plan/plan-writes.ts';
import type { WritePlan } from '../../core/write-plan/types.ts';
import { ShellCodes } from '../codes.ts';
import { saveConfig } from '../config/save.ts';
import { errorReason } from '../fs.ts';
import { sha1Of } from '../hash.ts';
import { applyWrites } from './apply-writes.ts';
import { readExecutables } from './disk-state.ts';
import { withProjectLock } from './lock.ts';
import { readDigests, readWriteState } from './read-inputs.ts';
import { restoreCaseRenames } from './spelling.ts';

/** What writing a tree did: the plan (its ops and diagnostics) and whether it was applied. */
export interface TreeWrite {
  readonly plan: WritePlan;
  readonly applied: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** A tree write, or why it could not be planned (the snapshot could not be read, the lock is held). */
export type WriteOutcome = { readonly ok: true; readonly value: TreeWrite } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/**
 * Which directory a tree is written into, which decides how its C files are written:
 * - 'project': the project whose C files the result reconciled; they are edited in place (reconciled entries, D75 b);
 * - 'out': `generate --out`'s directory; every C file is a generated file there, rewritten by a later run into it
 *   (outTreeEntriesOf, D77 d);
 * - 'fresh': a new tree (init's); the C files are the c-stub writer's scaffold files (generatedEntries).
 */
export type TreeTarget = 'project' | 'out' | 'fresh';

/** What a tree write reads: a checked generate result's stream (plus any scaffold entries). */
export interface TreeSource {
  readonly rom: Rom;
  readonly result: Pick<GenerateResult, 'model' | 'cx' | 'paths' | 'stubs'>;
  /** Entries written beside the stream (init's scaffold). */
  readonly extra?: readonly FileEntry[];
  /** Default 'fresh'. */
  readonly target?: TreeTarget;
}

function* streamOf(source: TreeSource): Generator<FileEntry> {
  switch (source.target ?? 'fresh') {
    case 'project':
      yield* projectTreeEntries(source.rom, source.result, (text) => sha1Of(text));
      break;
    case 'out':
      yield* outTreeEntriesOf(source.rom, source.result);
      break;
    case 'fresh':
      yield* generatedEntries(source.rom, source.result);
      break;
  }
  yield* source.extra ?? [];
}

/**
 * Plans the tree into `dir` and, unless `dryRun`, applies it: the case renames an interrupted run's journal left half
 * done are put back first, then the snapshot, planWrites, and applyWrites when the plan has no error and changes
 * something. The caller holds the project lock when it applies.
 */
export async function planAndApply(dir: string, source: TreeSource, romlift: string, dryRun: boolean): Promise<WriteOutcome> {
  const paths = [...source.result.paths, ...(source.extra ?? []).map((e) => e.path)];
  let state = await readWriteState(dir, paths);
  if (!state.ok) return state;
  if (!dryRun && state.value.journal !== null) {
    const restored = await restoreCaseRenames(dir, state.value.journal);
    if (restored !== undefined) return { ok: false, diagnostics: [restored] };
    state = await readWriteState(dir, paths);
    if (!state.ok) return state;
  }
  const reconciledTexts = source.target === 'project' ? reconciledTextsOf(source.result) : state.value.reconciledTexts;
  const executables = await readExecutables(dir, (source.extra ?? []).filter((e) => e.ownership === 'scaffold' && e.executable === true).map((e) => e.path));
  const plan = planWrites(projectPlanInputs(streamOf(source), { ...state.value, reconciledTexts, executables }, (text) => sha1Of(text), romlift, retainedPrefixes(source.result.model)));
  const errors = plan.diagnostics.some((d) => d.severity === 'error');
  if (dryRun || errors || planChangesNothing(plan, state.value)) return { ok: true, value: { plan, applied: false, diagnostics: plan.diagnostics } };
  const applied = await applyWrites(dir, plan);
  return { ok: true, value: { plan, applied: applied.ok, diagnostics: [...plan.diagnostics, ...applied.diagnostics] } };
}

/** `fn` under the project lock of `dir`, its outcome flattened: the lock's own diagnostics (W_STALE_LOCK) first. */
export async function underProjectLock(dir: string, fn: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
  const locked = await withProjectLock(dir, fn);
  if (!locked.ok) return locked;
  const inner = locked.value;
  if (!inner.ok) return { ok: false, diagnostics: [...locked.diagnostics, ...inner.diagnostics] };
  return { ok: true, value: { ...inner.value, diagnostics: [...locked.diagnostics, ...inner.value.diagnostics] } };
}

/** `generate`'s write: plan the tree into `dir` (the project, or `--out`), then apply it under the lock unless `dryRun`. */
export async function writeTree(dir: string, source: TreeSource, romlift: string, dryRun: boolean): Promise<WriteOutcome> {
  if (dryRun) return planAndApply(dir, source, romlift, true);
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${dir}: ${errorReason(error)}`, { path: dir })] };
  }
  return underProjectLock(dir, () => planAndApply(dir, source, romlift, false));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** What `init` writes besides the tree: its plan's own files (InitPlan.files, InitPlan.romCopy) and the ROM given. */
export interface InitFiles {
  /** The ROM `init` was given, absolute; copied to `romCopy` unless it is that file. */
  readonly romPath: string;
  /** The project path the ROM is copied to (InitPlan.romCopy). */
  readonly romCopy: string;
  /** The text files init owns, as [path, text] (InitPlan.files). */
  readonly files: readonly InitFile[];
}

/**
 * Writes init's own files into `dir`, each only when it is absent (a project init runs in again holds them unchanged,
 * which writeInitProject checked under the lock): the ROM at its project path (copied, the original kept), each text
 * file (saveConfig: a temporary file, flushed, renamed).
 */
async function writeInitFiles(dir: string, files: InitFiles): Promise<Diagnostic | undefined> {
  const rom = join(dir, files.romCopy);
  if (resolve(files.romPath) !== resolve(rom) && !(await exists(rom))) {
    try {
      await copyFile(files.romPath, rom);
    } catch (error) {
      return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot copy ${files.romPath} to ${rom}: ${errorReason(error)}`, { path: files.romCopy });
    }
  }
  for (const [path, text] of files.files) {
    if (await exists(join(dir, path))) continue;
    const saved = await saveConfig(dir, text, path);
    if (!saved.ok) return saved.diagnostic;
  }
  return undefined;
}

/**
 * `init`'s write: a tree write, or a failure, `refused` when init's directory check refused it before anything was
 * written (one of init's own files differs from what init writes, or its digest could not be read), so the command
 * prints only that refusal.
 */
export type InitWriteOutcome = { readonly ok: true; readonly value: TreeWrite } | { readonly ok: false; readonly refused: boolean; readonly diagnostics: readonly Diagnostic[] };

/** What init's own files must be on disk (absent or these digests): each text file's and the ROM copy's. */
function initDigests(files: InitFiles, rom: Rom): ReadonlyMap<string, string> {
  return new Map([...files.files.map(([path, text]) => [path, sha1Of(text)] as const), [files.romCopy, rom.sha1]]);
}

/**
 * `init`'s write, under the project lock of `dir` (created when absent): first the digests of init's own files on disk,
 * which must be absent or what init writes (initDigests, from `files` and the ROM; core/workflow/init.ts
 * replacedProblems decides, E_DIR_NOT_EMPTY), read under the lock so a file changed since the command looked cannot
 * be kept beside a tree made from another config (D77 j; computed here since fix round 3, so the check cannot be
 * skipped, D78 f); then its own files (writeInitFiles, the same set), then the tree and the scaffold (planAndApply
 * with `source.extra` the scaffold; setup.sh is written executable).
 */
export async function writeInitProject(dir: string, files: InitFiles, source: TreeSource, romlift: string): Promise<InitWriteOutcome> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    return { ok: false, refused: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${dir}: ${errorReason(error)}`, { path: dir })] };
  }
  const wanted = initDigests(files, source.rom);
  let refused = false;
  const outcome = await underProjectLock(dir, async () => {
    const current = await readDigests(dir, wanted.keys());
    const replaced = current.ok ? replacedProblems(dir, wanted, current.value) : current.diagnostics;
    if (replaced.length > 0) {
      refused = true;
      return { ok: false, diagnostics: replaced };
    }
    const failed = await writeInitFiles(dir, files);
    if (failed !== undefined) return { ok: false, diagnostics: [failed] };
    return planAndApply(dir, source, romlift, false);
  });
  return outcome.ok ? outcome : { ok: false, refused, diagnostics: outcome.diagnostics };
}

/** Whether `dir` holds a package-lock.json already (init's lock step is then skipped). */
export async function hasPackageLock(dir: string): Promise<boolean> {
  return exists(join(dir, 'package-lock.json'));
}
