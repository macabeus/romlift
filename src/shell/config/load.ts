// Loading a project's config (architecture §6.5): the decomp.yaml in the project directory, the romlift.toml its
// `tools.romlift.config` names, and that text parsed. The text comes back with the value, because the patch planner
// edits the text and generate compares nothing but reads it (g4.no-toml-write). Every refusal is a diagnostic:
// E_PROJECT_NOT_FOUND (no decomp.yaml in the directory), E_IO_READ, E_DECOMP_YAML_INVALID and the parser's codes,
// each carrying the file it is about as its project-relative `path`. Decides nothing: the reading rules are
// core/config's (readDecompYaml, parseConfig).
import { basename, join, resolve } from 'node:path';

import { readDecompYaml } from '../../core/config/decomp-yaml.ts';
import type { DecompYamlProject } from '../../core/config/decomp-yaml.ts';
import { parseConfig } from '../../core/config/parse.ts';
import type { RomliftConfig } from '../../core/config/schema.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ShellCodes } from '../codes.ts';
import { readBytes } from '../fs.ts';
import { sha1Of } from '../hash.ts';
import { decompYamlIn } from '../project/locate.ts';

/** A project's config as loadConfig read it. */
export interface ProjectConfig {
  /** The project directory, absolute. */
  readonly dir: string;
  /** Its decomp.yaml, absolute. */
  readonly decompYaml: string;
  /** What decomp.yaml says: the config's project path, the ROM, the build name, the SHA-1. */
  readonly project: DecompYamlProject;
  /** romlift.toml, absolute. */
  readonly configPath: string;
  /** romlift.toml as it is on disk. */
  readonly text: string;
  /**
   * The SHA-1 of the exact bytes `text` was decoded from (fix round 7, architecture-b2-2): what modules.mk records
   * (D82 a), so the stamp is of the TOML the tree was generated from, with no second read in between.
   */
  readonly sha1: string;
  /** The text parsed. */
  readonly value: RomliftConfig;
  /** The parser's warnings (none in schema 1). */
  readonly diagnostics: readonly Diagnostic[];
}

export type LoadConfigResult = { readonly ok: true; readonly value: ProjectConfig } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The text of `path`, or the diagnostic of reading it (`label` names it in messages). */
async function readText(path: string, label: string): Promise<{ readonly ok: true; readonly text: string; readonly bytes: Uint8Array } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }> {
  const read = await readBytes(path);
  if (!read.ok) return { ok: false, diagnostics: [{ ...read.diagnostic, path: label }] };
  try {
    return { ok: true, text: UTF8.decode(read.value), bytes: read.value };
  } catch {
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${label}: it is not UTF-8 text`, { path: label })] };
  }
}

function withPath(diagnostics: readonly Diagnostic[], path: string): Diagnostic[] {
  return diagnostics.map((d) => ({ ...d, path }));
}

/** The config of the project in `dir` (its root, as locateProject returns it). */
export async function loadConfig(projectDir: string): Promise<LoadConfigResult> {
  const dir = resolve(projectDir);
  const found = await decompYamlIn(dir);
  if (!found.ok) return found;
  if (found.path === undefined) {
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_PROJECT_NOT_FOUND', `no decomp.yaml in ${dir}; run \`romlift init <rom>\` to create a project`, { path: dir })] };
  }
  const yamlName = basename(found.path);
  const yaml = await readText(found.path, yamlName);
  if (!yaml.ok) return yaml;
  const project = readDecompYaml(yaml.text, yamlName);
  if (!project.ok) return { ok: false, diagnostics: withPath(project.diagnostics, yamlName) };
  const configPath = join(dir, project.value.config);
  const toml = await readText(configPath, project.value.config);
  if (!toml.ok) return toml;
  const parsed = parseConfig(toml.text);
  if (!parsed.ok) return { ok: false, diagnostics: withPath(parsed.diagnostics, project.value.config) };
  return {
    ok: true,
    value: {
      dir,
      decompYaml: found.path,
      project: project.value,
      configPath,
      text: toml.text,
      sha1: sha1Of(toml.bytes),
      value: parsed.value,
      diagnostics: withPath(parsed.diagnostics, project.value.config),
    },
  };
}
