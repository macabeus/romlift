// `romlift rename <old> <new>` on disk (architecture §2.1, §6.4, §6.6, D17, D92): the shell half of
// core/workflow/rename.ts. Under the project lock it reads romlift.toml (loadConfig), the C texts with the sha1 of their
// bytes and the files it leaves out (readRenameTexts: src/**/*.c, src/**/*.h, include/**), the project's ROM (whose
// model's names a new name may not take, renameModelNames, D95 c), and the write state (manifest, journal, disk); then
// planRename decides, the identifier edits go through planEdits and applyWrites (an `edit` op over its base sha1, hashed
// again right before its write: E_STALE_EDIT, the journal before the first op), and last romlift.toml is saved
// (saveConfig) after the check that it is still the text the plan was made from (E_STALE_CONFIG). It never runs
// `generate`: the chunk file and the stub follow at the next one. A refusal (E_RENAME_*, E_TOML_PATCH_REFUSED,
// E_RENAME_INTERRUPTED, a stale edit or config found before any write) changes no file. Mechanical: every decision is
// the workflow's or planEdits'.
import { join } from 'node:path';

import { planRename, renameJournalProblems, renameModelNames, staleRenameConfig } from '../../core/workflow/rename.ts';
import type { RenameEdit } from '../../core/workflow/rename.ts';
import { planEdits, planHasErrors } from '../../core/write-plan/plan-writes.ts';
import type { WriteOp } from '../../core/write-plan/types.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { loadConfig } from '../config/load.ts';
import { saveConfig } from '../config/save.ts';
import { sha1Of } from '../hash.ts';
import { readRom } from '../rom.ts';
import { applyWrites } from './apply-writes.ts';
import { locateProject } from './locate.ts';
import { withProjectLock } from './lock.ts';
import { packageVersion, readProjectTexts, readRenameTexts, readWriteState } from './read-inputs.ts';

/** What a rename did. */
export interface RenameOutcome {
  /** Every edit and the TOML were written; false on a refusal or a failed write. */
  readonly ok: boolean;
  /** The project path of the patched config (romlift.toml), when the project was found. */
  readonly configPath?: string;
  /** The planned identifier edits, one entry per file, by path (none on a refusal). */
  readonly edits: readonly RenameEdit[];
  /** The write ops planned for them (edit or keep), by path. */
  readonly ops: readonly WriteOp[];
  /** Whether the edits were applied. */
  readonly applied: boolean;
  /** Whether romlift.toml was saved. */
  readonly tomlWritten: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

function refusal(diagnostics: readonly Diagnostic[], configPath?: string): RenameOutcome {
  return {
    ok: false,
    ...(configPath === undefined ? {} : { configPath }),
    edits: [],
    ops: [],
    applied: false,
    tomlWritten: false,
    diagnostics,
  };
}

/** The rename, once the project's directory is known and its lock is held. */
async function renameLocked(dir: string, from: string, to: string): Promise<RenameOutcome> {
  const loaded = await loadConfig(dir);
  if (!loaded.ok) return refusal(loaded.diagnostics);
  const configPath = loaded.value.project.config;
  const read = await readRenameTexts(
    dir,
    loaded.value.value.modules.flatMap((m) => (m.source === undefined ? [] : [m.source])),
  );
  if (!read.ok) return refusal(read.diagnostics, configPath);
  const rom = await readRom(join(dir, ...loaded.value.value.rom.path.split('/')));
  if (!rom.ok) return refusal([rom.diagnostic], configPath);
  const names = renameModelNames({ rom: rom.value, config: loaded.value.value });
  if (!names.ok) return refusal(names.diagnostics, configPath);
  const plan = planRename({
    configText: loaded.value.text,
    config: loaded.value.value,
    from,
    to,
    texts: read.value.texts,
    sha1s: read.value.sha1s,
    skipped: read.value.skipped,
    modelNames: names.names,
  });
  if (!plan.ok) return refusal(plan.diagnostics, configPath);
  const state = await readWriteState(
    dir,
    plan.edits.map((e) => e.path),
  );
  if (!state.ok) return refusal(state.diagnostics, configPath);
  const interrupted = renameJournalProblems(state.value.journal);
  if (interrupted.length > 0) return refusal(interrupted, configPath);
  const version = await packageVersion();
  const writePlan = planEdits({
    entries: plan.edits,
    manifest: state.value.manifest,
    disk: state.value.disk,
    reconciledTexts: read.value.texts,
    hash: (text) => sha1Of(text),
    journal: state.value.journal,
    ...(version.ok ? { romlift: version.value } : {}),
  });
  const base = { configPath, edits: plan.edits, ops: writePlan.ops };
  if (planHasErrors(writePlan))
    return { ...base, ok: false, applied: false, tomlWritten: false, diagnostics: writePlan.diagnostics };
  // The config must still be the text the plan was made from, before the first write and again right before its save.
  const before = await currentText(dir, configPath);
  const staleBefore = before.ok ? staleRenameConfig(configPath, loaded.value.text, before.text) : before.diagnostics;
  if (staleBefore.length > 0)
    return { ...base, ok: false, applied: false, tomlWritten: false, diagnostics: staleBefore };
  let applied = false;
  if (writePlan.ops.some((op) => op.op !== 'keep')) {
    const result = await applyWrites(dir, writePlan);
    if (!result.ok)
      return {
        ...base,
        ok: false,
        applied: false,
        tomlWritten: false,
        diagnostics: [...writePlan.diagnostics, ...result.diagnostics],
      };
    applied = true;
  }
  const now = await currentText(dir, configPath);
  const stale = now.ok ? staleRenameConfig(configPath, loaded.value.text, now.text) : now.diagnostics;
  if (stale.length > 0)
    return { ...base, ok: false, applied, tomlWritten: false, diagnostics: [...writePlan.diagnostics, ...stale] };
  const saved = await saveConfig(dir, plan.tomlText, configPath);
  if (!saved.ok)
    return {
      ...base,
      ok: false,
      applied,
      tomlWritten: false,
      diagnostics: [...writePlan.diagnostics, saved.diagnostic],
    };
  return {
    ...base,
    ok: true,
    applied,
    tomlWritten: true,
    diagnostics: [...writePlan.diagnostics, ...plan.diagnostics],
  };
}

/** romlift.toml's text as it is on disk now (undefined when it is gone), or the failure to read it. */
async function currentText(
  dir: string,
  configPath: string,
): Promise<
  | { readonly ok: true; readonly text: string | undefined }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
> {
  const now = await readProjectTexts(dir, [configPath]);
  return now.ok ? { ok: true, text: now.value.get(configPath) } : now;
}

/**
 * Renames `from` to `to` in the project that holds `dir` (a directory inside it): romlift.toml's entry on one line, its
 * `from` key dropped, and the identifier tokens of src/ and include/, under the project lock (E_PROJECT_LOCKED while
 * another run holds it). The outcome says what was planned and written; a refusal writes nothing.
 */
export async function renameInProject(dir: string, from: string, to: string): Promise<RenameOutcome> {
  const located = await locateProject(dir);
  if (!located.ok) return refusal(located.diagnostics);
  const locked = await withProjectLock(located.value.dir, () => renameLocked(located.value.dir, from, to));
  if (!locked.ok) return refusal(locked.diagnostics);
  return { ...locked.value, diagnostics: [...locked.diagnostics, ...locked.value.diagnostics] };
}
