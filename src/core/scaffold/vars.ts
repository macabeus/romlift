// The scaffold's frozen contract (architecture §6.3 "The scaffold", D74): the values a scaffold is rendered
// with (ScaffoldVars), the list of scaffold files and where each lands in a project (templates/MANIFEST.json,
// decoded here), the placeholder spelling templates and manifest targets share, and the pinned agbcc
// reference (templates/agbcc.json). renderScaffold (core/scaffold/render.ts) renders them; the shell reads
// the template files (shell/project/templates.ts). Pure: a text that is not a manifest or a pin decodes to an
// error value, never a throw.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import { BASEROM_FILE, INCLUDE_ASM_HEADER_PATH } from '../../foundation/util/project-files.ts';
import { isProjectPath } from '../../foundation/util/project-path.ts';

/** The pinned agbcc a project builds with: templates/agbcc.json, the submodule `.gitmodules` and setup.sh name. */
export interface AgbccPin {
  /** The repository setup.sh clones (pret/agbcc). */
  readonly url: string;
  /** The commit tools/agbcc is checked out at: forty lower-case hex digits. */
  readonly commit: string;
}

/** What a scaffold is rendered with; every member is plain data (D19). */
export interface ScaffoldVars {
  /** The build name ([build] name): the built ROM and the SHA-1 file are named after it. */
  readonly name: string;
  /** The user's ROM in the project (`baserom.gba`), whatever name `init` was given. */
  readonly romFile: typeof BASEROM_FILE;
  /** The ROM `make` builds: `<name>.gba`. */
  readonly builtRom: string;
  /** The ROM's SHA-1, forty lower-case hex digits. */
  readonly sha1: string;
  /** The SHA-1 file: `<name>.sha1`, in sha1sum format `<sha1>  <builtRom>`. */
  readonly sha1File: string;
  /** The exact romlift version package.json pins. */
  readonly romliftVersion: string;
  readonly agbcc: AgbccPin;
  /** The cartridge header's game title (0x080000A0, twelve bytes, trailing NULs dropped). */
  readonly title: string;
}

/** The ScaffoldVars of a build name: `<name>.gba` and `<name>.sha1` derived from it. */
export function scaffoldVars(input: {
  readonly name: string;
  readonly sha1: string;
  readonly romliftVersion: string;
  readonly agbcc: AgbccPin;
  readonly title: string;
}): ScaffoldVars {
  return {
    name: input.name,
    romFile: BASEROM_FILE,
    builtRom: `${input.name}.gba`,
    sha1: input.sha1,
    sha1File: `${input.name}.sha1`,
    romliftVersion: input.romliftVersion,
    agbcc: input.agbcc,
    title: input.title,
  };
}

// ---------------------------------------------------------------------------------------------------
// Placeholders: `@@<placeholder>@@` in a template's text and in a manifest target. `@@` does not occur in
// a Makefile, a POSIX shell script, YAML (GitHub's `${{ … }}` is another spelling) or Markdown romlift ships.

export const SCAFFOLD_PLACEHOLDERS = ['name', 'romFile', 'builtRom', 'sha1', 'sha1File', 'romliftVersion', 'title', 'agbccUrl', 'agbccCommit'] as const;
export type ScaffoldPlaceholder = (typeof SCAFFOLD_PLACEHOLDERS)[number];

/** A placeholder as it is written in a template or a manifest target. */
export function placeholderText(placeholder: ScaffoldPlaceholder): string {
  return `@@${placeholder}@@`;
}

/** The text each placeholder renders to. */
export function placeholderValues(vars: ScaffoldVars): Readonly<Record<ScaffoldPlaceholder, string>> {
  return {
    name: vars.name,
    romFile: vars.romFile,
    builtRom: vars.builtRom,
    sha1: vars.sha1,
    sha1File: vars.sha1File,
    romliftVersion: vars.romliftVersion,
    title: vars.title,
    agbccUrl: vars.agbcc.url,
    agbccCommit: vars.agbcc.commit,
  };
}

const PLACEHOLDER = /@@([A-Za-z0-9]*)@@/g;

/** The placeholder names `text` spells, in order (a name may be unknown); a lone `@@` is not one. */
export function placeholdersIn(text: string): readonly string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
}

function isPlaceholder(name: string): name is ScaffoldPlaceholder {
  return (SCAFFOLD_PLACEHOLDERS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------------------------------
// The manifest: templates/MANIFEST.json.

/** One scaffold file. */
export interface ScaffoldTemplate {
  /** The project path it is written to; may hold placeholders (`@@sha1File@@`). */
  readonly target: string;
  /**
   * The template it is rendered from, relative to templates/; null when romlift renders it itself, from
   * ScaffoldVars (`<name>.sha1`, `package.json`, `.gitmodules`) or from the dialect (`include/macros.inc`,
   * `include/include_asm.h`): exactly the targets of ROMLIFT_RENDERED_TARGETS.
   */
  readonly source: string | null;
  /** Written with the executable bits (setup.sh). */
  readonly executable: boolean;
}

export interface ScaffoldManifest {
  readonly schema: 1;
  readonly files: readonly ScaffoldTemplate[];
}

/** The manifest and the text of every template it names (source path -> text), as the shell read them. */
export interface ScaffoldTemplates {
  readonly manifest: ScaffoldManifest;
  readonly texts: ReadonlyMap<string, string>;
}

/** The targets romlift renders without a template file (`source: null`), and no others; the two headers' paths are the dialect's and project-files.ts's, the ones render.ts's renderers are keyed by. */
export const ROMLIFT_RENDERED_TARGETS: readonly string[] = [
  placeholderText('sha1File'),
  'package.json',
  '.gitmodules',
  DIALECT.macrosPath,
  INCLUDE_ASM_HEADER_PATH,
];

export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string): Decoded<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, message: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function unknownKey(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !allowed.includes(key));
}

/** Why `target` is not a manifest target, or undefined. */
function targetProblem(target: string): string | undefined {
  const unknown = placeholdersIn(target).find((name) => !isPlaceholder(name));
  if (unknown !== undefined) return `unknown placeholder @@${unknown}@@`;
  const filled = target.replace(PLACEHOLDER, 'x');
  if (filled.includes('@@')) return 'a lone @@';
  return isProjectPath(filled) ? undefined : 'not a project path';
}

function decodeTemplate(value: unknown, at: string): Decoded<ScaffoldTemplate> {
  if (!isRecord(value)) return { ok: false, message: `${at} is not an object` };
  const extra = unknownKey(value, ['target', 'source', 'executable']);
  if (extra !== undefined) return { ok: false, message: `${at}: unknown member ${JSON.stringify(extra)}` };
  const { target, source, executable } = value;
  if (typeof target !== 'string') return { ok: false, message: `${at}.target is not a string` };
  const problem = targetProblem(target);
  if (problem !== undefined) return { ok: false, message: `${at}.target ${JSON.stringify(target)}: ${problem}` };
  if (source !== null && (typeof source !== 'string' || !isProjectPath(source) || placeholdersIn(source).length > 0)) {
    return { ok: false, message: `${at}.source is neither null nor a path under templates/` };
  }
  if (typeof executable !== 'boolean') return { ok: false, message: `${at}.executable is not a boolean` };
  const rendered = ROMLIFT_RENDERED_TARGETS.includes(target);
  if (rendered !== (source === null)) {
    return { ok: false, message: rendered ? `${at}: ${target} is rendered by romlift, its source must be null` : `${at}: ${target} has no template (source null)` };
  }
  return { ok: true, value: { target, source, executable } };
}

/** Reads templates/MANIFEST.json strictly: schema 1, files with unique targets and every rendered target listed. */
export function decodeScaffoldManifest(json: string): Decoded<ScaffoldManifest> {
  const parsed = parseJson(json);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!isRecord(value)) return { ok: false, message: 'not a JSON object' };
  const extra = unknownKey(value, ['schema', 'files']);
  if (extra !== undefined) return { ok: false, message: `unknown member ${JSON.stringify(extra)}` };
  if (value['schema'] !== 1) return { ok: false, message: `schema ${JSON.stringify(value['schema'])}, expected 1` };
  const member = value['files'];
  if (!Array.isArray(member)) return { ok: false, message: 'files is not an array' };
  const list: readonly unknown[] = member;
  const files: ScaffoldTemplate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const file = decodeTemplate(list[i], `files[${i}]`);
    if (!file.ok) return file;
    if (seen.has(file.value.target)) return { ok: false, message: `files[${i}].target ${JSON.stringify(file.value.target)} is listed twice` };
    seen.add(file.value.target);
    files.push(file.value);
  }
  const missing = ROMLIFT_RENDERED_TARGETS.find((target) => !seen.has(target));
  if (missing !== undefined) return { ok: false, message: `files does not list ${missing}` };
  return { ok: true, value: { schema: 1, files } };
}

const COMMIT = /^[0-9a-f]{40}$/;

/** Reads templates/agbcc.json strictly: `{ "url": string, "commit": <forty lower-case hex digits> }`. */
export function decodeAgbccPin(json: string): Decoded<AgbccPin> {
  const parsed = parseJson(json);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!isRecord(value)) return { ok: false, message: 'not a JSON object' };
  const extra = unknownKey(value, ['url', 'commit']);
  if (extra !== undefined) return { ok: false, message: `unknown member ${JSON.stringify(extra)}` };
  const { url, commit } = value;
  if (typeof url !== 'string' || url.length === 0) return { ok: false, message: 'url is not a string' };
  if (typeof commit !== 'string' || !COMMIT.test(commit)) return { ok: false, message: 'commit is not forty lower-case hex digits' };
  return { ok: true, value: { url, commit } };
}
