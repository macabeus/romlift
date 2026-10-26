// Finding a project (architecture §6.5): the nearest directory, from `from` up to the file system's root, that holds
// a decomp.yaml (or decomp.yml, the other name the decomp_settings spec allows, after it). A git worktree of a
// project holds its own committed decomp.yaml, so the walk stops there and never reaches the main checkout. Nothing
// found is E_PROJECT_NOT_FOUND; a directory that cannot be examined is E_IO_READ. Decides nothing else: reading the
// file is loadConfig's (shell/config/load.ts).
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ShellCodes } from '../codes.ts';
import type { ShellCode } from '../codes.ts';
import { DECOMP_YAML_NAMES } from '../../foundation/util/project-files.ts';
import { errorReason, isAbsentError } from '../fs.ts';

/** A located project: its root directory and its decomp.yaml, both absolute. */
export interface ProjectLocation {
  readonly dir: string;
  readonly decompYaml: string;
}

export type LocateResult = { readonly ok: true; readonly value: ProjectLocation } | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ShellCode>[] };

/** Whether `path` is a regular file, or why it cannot be examined. */
async function isFile(path: string): Promise<{ readonly ok: true; readonly file: boolean } | { readonly ok: false; readonly reason: string }> {
  try {
    return { ok: true, file: (await stat(path)).isFile() };
  } catch (error) {
    if (isAbsentError(error)) return { ok: true, file: false };
    return { ok: false, reason: errorReason(error) };
  }
}

/** The settings file in `dir` itself, or undefined; E_IO_READ when `dir` cannot be examined. */
export async function decompYamlIn(dir: string): Promise<{ readonly ok: true; readonly path: string | undefined } | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ShellCode>[] }> {
  for (const name of DECOMP_YAML_NAMES) {
    const path = join(dir, name);
    const found = await isFile(path);
    if (!found.ok) return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot examine ${path}: ${found.reason}`, { path })] };
    if (found.file) return { ok: true, path };
  }
  return { ok: true, path: undefined };
}

/** The project that holds `from` (a directory, default the working directory). */
export async function locateProject(from: string = process.cwd()): Promise<LocateResult> {
  const start = resolve(from);
  for (let dir = start; ; ) {
    const found = await decompYamlIn(dir);
    if (!found.ok) return found;
    if (found.path !== undefined) return { ok: true, value: { dir, decompYaml: found.path } };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {
    ok: false,
    diagnostics: [
      diagnostic(ShellCodes, 'E_PROJECT_NOT_FOUND', `no decomp.yaml in ${start} or any parent directory; run \`romlift init <rom>\` to create a project`, {
        path: start,
      }),
    ],
  };
}
