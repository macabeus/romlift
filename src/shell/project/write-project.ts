// Writing a project (architecture §6.4 steps 3 and 4, D17, D49): what `init` and `generate` do with a plan once the
// workflow made it. A tree (a model's emission stream, plus init's scaffold) is planned against a directory's snapshot
// by planWrites and applied by applyWrites under the project lock; a plan that changes nothing is not applied at all,
// so no file, the manifest included, gets a new modification time (g4.generate-idempotent). `init`'s own files are
// written here too: the ROM copied to baserom.gba, romlift.toml and decomp.yaml saved (shell/config/save.ts), the
// scaffold's executable files made executable. Mechanical: every decision is planWrites' or a workflow's.
import { chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { DECOMP_YAML_FILE, ROMLIFT_CONFIG_FILE } from '../../core/config/decomp-yaml.ts';
import type { FileEntry } from '../../core/emit/tree.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { SCAFFOLD_ROM_FILE } from '../../core/scaffold/vars.ts';
import { generatedEntries, planChangesNothing, projectPlanInputs, projectTreeEntries, reconciledTextsOf } from '../../core/workflow/generate.ts';
import type { GenerateResult } from '../../core/workflow/generate.ts';
import { isExecutableEntry } from '../../core/workflow/init.ts';
import { planWrites } from '../../core/write-plan/plan-writes.ts';
import type { WritePlan } from '../../core/write-plan/types.ts';
import { ShellCodes } from '../codes.ts';
import { saveConfig } from '../config/save.ts';
import { errorReason } from '../fs.ts';
import { sha1Of } from '../hash.ts';
import { applyWrites } from './apply-writes.ts';
import { onDisk } from './disk-state.ts';
import { withProjectLock } from './lock.ts';
import { readWriteState } from './read-inputs.ts';
import { restoreCaseRenames } from './spelling.ts';

/** What writing a tree did: the plan (its ops and diagnostics) and whether it was applied. */
export interface TreeWrite {
  readonly plan: WritePlan;
  readonly applied: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** A tree write, or why it could not be planned (the snapshot could not be read, the lock is held). */
export type WriteOutcome = { readonly ok: true; readonly value: TreeWrite } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** What a tree write reads: a checked generate result's stream (plus any scaffold entries). */
export interface TreeSource {
  readonly rom: Rom;
  readonly result: Pick<GenerateResult, 'model' | 'cx' | 'paths' | 'stubs'>;
  /** Entries written beside the stream (init's scaffold). */
  readonly extra?: readonly FileEntry[];
  /**
   * The directory is the project whose C files the result reconciled: they are edited in place (reconciled entries,
   * D75 b). Otherwise (`generate --out`) the directory gets their reconciled texts as files written when absent.
   */
  readonly inProject?: boolean;
}

function* streamOf(source: TreeSource): Generator<FileEntry> {
  yield* source.inProject === true ? projectTreeEntries(source.rom, source.result, (text) => sha1Of(text)) : generatedEntries(source.rom, source.result);
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
  const reconciledTexts = source.inProject === true ? reconciledTextsOf(source.result) : state.value.reconciledTexts;
  const plan = planWrites(projectPlanInputs(source.result.model, streamOf(source), { ...state.value, reconciledTexts }, (text) => sha1Of(text), romlift));
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

/** What `init` writes besides the tree. */
export interface InitFiles {
  /** The ROM `init` was given, absolute; copied to baserom.gba unless it is that file. */
  readonly romPath: string;
  readonly tomlText: string;
  readonly decompYamlText: string;
}

/**
 * Writes init's own files into `dir`, each only when it is absent (a project init runs in again holds them unchanged,
 * which the command checked first): the ROM as baserom.gba (copied, the original kept), romlift.toml and decomp.yaml
 * (saveConfig: a temporary file, flushed, renamed).
 */
async function writeInitFiles(dir: string, files: InitFiles): Promise<Diagnostic | undefined> {
  const rom = join(dir, SCAFFOLD_ROM_FILE);
  if (resolve(files.romPath) !== resolve(rom) && !(await exists(rom))) {
    try {
      await copyFile(files.romPath, rom);
    } catch (error) {
      return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot copy ${files.romPath} to ${rom}: ${errorReason(error)}`, { path: SCAFFOLD_ROM_FILE });
    }
  }
  for (const [path, text] of [[ROMLIFT_CONFIG_FILE, files.tomlText], [DECOMP_YAML_FILE, files.decompYamlText]] as const) {
    if (await exists(join(dir, path))) continue;
    const saved = await saveConfig(dir, text, path);
    if (!saved.ok) return saved.diagnostic;
  }
  return undefined;
}

/** Gives the executable bits to every scaffold file the manifest marks executable (setup.sh) that `plan` wrote. */
async function markExecutable(dir: string, scaffold: readonly FileEntry[], plan: WritePlan): Promise<Diagnostic | undefined> {
  const written = new Set(plan.ops.filter((op) => op.op === 'write').map((op) => op.path));
  for (const entry of scaffold) {
    if (!isExecutableEntry(entry) || !written.has(entry.path)) continue;
    try {
      await chmod(onDisk(dir, entry.path), 0o755);
    } catch (error) {
      return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot make ${entry.path} executable: ${errorReason(error)}`, { path: entry.path });
    }
  }
  return undefined;
}

/**
 * `init`'s write, under the project lock of `dir` (created when absent): its own files (writeInitFiles), then the
 * tree and the scaffold (planAndApply with `source.extra` the scaffold), then the executable bits.
 */
export async function writeInitProject(dir: string, files: InitFiles, source: TreeSource, romlift: string): Promise<WriteOutcome> {
  try {
    await mkdir(dir, { recursive: true });
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${dir}: ${errorReason(error)}`, { path: dir })] };
  }
  return underProjectLock(dir, async () => {
    const failed = await writeInitFiles(dir, files);
    if (failed !== undefined) return { ok: false, diagnostics: [failed] };
    const tree = await planAndApply(dir, source, romlift, false);
    if (!tree.ok || !tree.value.applied) return tree;
    const chmodFailed = await markExecutable(dir, source.extra ?? [], tree.value.plan);
    return chmodFailed === undefined ? tree : { ok: true, value: { ...tree.value, diagnostics: [...tree.value.diagnostics, chmodFailed] } };
  });
}

/** Whether `dir` holds a package-lock.json already (init's lock step is then skipped). */
export async function hasPackageLock(dir: string): Promise<boolean> {
  return exists(join(dir, 'package-lock.json'));
}
