// The scaffold renderer (architecture §6.3 "The scaffold", D74 d, roadmap 4.B): every file of
// templates/MANIFEST.json rendered over ScaffoldVars, as tree entries the write plan writes only when absent.
// A file with a template is its text with each `@@<placeholder>@@` replaced by its value, in one pass, so a
// value is never read as a placeholder; the five files romlift renders itself (ROMLIFT_RENDERED_TARGETS) come
// from the vars (`<name>.sha1`, package.json, .gitmodules) and from the dialect (include/macros.inc,
// include/include_asm.h), so neither header can drift from the text the checks read. Pure: the shell reads
// the templates (shell/project/templates.ts). A template that spells an unknown placeholder, a manifest source
// without its text and a rendered target without a renderer are bugs of the package: RomliftInvariantError.
import { DIALECT, INCLUDE_ASM_HEADER, INCLUDE_ASM_HEADER_PATH } from '../../foundation/asm/dialect.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { placeholdersIn, placeholderText, placeholderValues, ROMLIFT_RENDERED_TARGETS, SCAFFOLD_PLACEHOLDERS } from './vars.ts';
import type { ScaffoldPlaceholder, ScaffoldTemplates, ScaffoldVars } from './vars.ts';

/**
 * One rendered scaffold file: the `scaffold` member of core/emit/tree.ts FileEntry (core/scaffold may not import
 * core/emit, so it is spelled here and is assignable to it), plus whether it is written executable (setup.sh).
 */
export interface ScaffoldFileEntry {
  readonly ownership: 'scaffold';
  readonly path: string;
  readonly text: string;
  readonly writer: 'scaffold';
  /** The manifest's `executable`: written with the executable bits (absent: not executable). */
  readonly executable?: true;
}

const PLACEHOLDER = /@@([A-Za-z0-9]*)@@/g;

function isPlaceholder(name: string): name is ScaffoldPlaceholder {
  return (SCAFFOLD_PLACEHOLDERS as readonly string[]).includes(name);
}

/** `text` with every placeholder replaced by its value; `where` names the text in the error of an unknown one. */
function fill(text: string, values: Readonly<Record<ScaffoldPlaceholder, string>>, where: string): string {
  const unknown = placeholdersIn(text).find((name) => !isPlaceholder(name));
  if (unknown !== undefined) throw new RomliftInvariantError(`${where}: unknown placeholder @@${unknown}@@`);
  if (text.replace(PLACEHOLDER, '').includes('@@')) throw new RomliftInvariantError(`${where}: a lone @@ that is no placeholder`);
  return text.replace(PLACEHOLDER, (_match, name: string) => (isPlaceholder(name) ? values[name] : ''));
}

/**
 * The npm package name of a project: the build name in lower case, every run of characters npm refuses as `-`,
 * no leading `.`, `_` or `-`, at most 214 characters; `romlift-project` when nothing is left.
 */
export function npmPackageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+/, '')
    .slice(0, 214)
    .replace(/-+$/, '');
  return cleaned.length > 0 ? cleaned : 'romlift-project';
}

/** `<name>.sha1`, in sha1sum format: the ROM's SHA-1, two spaces, the ROM make builds. */
export function sha1FileText(vars: ScaffoldVars): string {
  return `${vars.sha1}  ${vars.builtRom}\n`;
}

/** package.json: a private package that pins the exact romlift version, so every checkout generates the same files. */
export function packageJsonText(vars: ScaffoldVars): string {
  const pkg = {
    name: npmPackageName(vars.name),
    version: '0.0.0',
    private: true,
    description: `A matching decompilation of ${vars.title.length > 0 ? vars.title : vars.name}, scaffolded by romlift`,
    scripts: { generate: 'romlift generate' },
    devDependencies: { romlift: vars.romliftVersion },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

/** The submodule's path in a project, where setup.sh builds agbcc (BUILD_COMPILERS' cc1 live under its bin/). */
export const AGBCC_SUBMODULE_PATH = 'tools/agbcc';

/**
 * .gitmodules: tools/agbcc from the pin's URL. `ignore = dirty` because setup.sh builds and installs agbcc inside
 * the submodule's work tree; the commit is the gitlink's, which setup.sh registers at the pin's commit.
 */
export function gitmodulesText(vars: ScaffoldVars): string {
  return [
    `# ${AGBCC_SUBMODULE_PATH}: pret/agbcc, registered by setup.sh at ${vars.agbcc.commit} (the commit romlift pins).`,
    `[submodule "${AGBCC_SUBMODULE_PATH}"]`,
    `\tpath = ${AGBCC_SUBMODULE_PATH}`,
    `\turl = ${vars.agbcc.url}`,
    '\tignore = dirty',
    '',
  ].join('\n');
}

/** The text of each target romlift renders without a template, by its manifest target. */
const RENDERERS: Readonly<Record<string, (vars: ScaffoldVars) => string>> = {
  [placeholderText('sha1File')]: sha1FileText,
  'package.json': packageJsonText,
  '.gitmodules': gitmodulesText,
  [DIALECT.macrosPath]: () => DIALECT.macrosInc,
  [INCLUDE_ASM_HEADER_PATH]: () => INCLUDE_ASM_HEADER,
};

function rendered(target: string, vars: ScaffoldVars): string {
  const render = ROMLIFT_RENDERED_TARGETS.includes(target) && Object.hasOwn(RENDERERS, target) ? RENDERERS[target] : undefined;
  if (render === undefined) throw new RomliftInvariantError(`scaffold: no renderer for ${target}, which the manifest says romlift renders`);
  return render(vars);
}

/**
 * Every scaffold file of `templates.manifest` rendered over `vars`, sorted by path (code units): ownership and
 * writer `scaffold`. Pure and deterministic.
 */
export function renderScaffold(vars: ScaffoldVars, templates: ScaffoldTemplates): readonly ScaffoldFileEntry[] {
  const values = placeholderValues(vars);
  const out: ScaffoldFileEntry[] = templates.manifest.files.map((file) => {
    const path = fill(file.target, values, `templates/MANIFEST.json target ${file.target}`);
    let text: string;
    if (file.source === null) text = rendered(file.target, vars);
    else {
      const template = templates.texts.get(file.source);
      if (template === undefined) throw new RomliftInvariantError(`scaffold: no text for the template ${file.source} of ${file.target}`);
      text = fill(template, values, `templates/${file.source}`);
    }
    return { ownership: 'scaffold', path, text, writer: 'scaffold', ...(file.executable ? { executable: true as const } : {}) };
  });
  return out.sort((a, b) => compareCodeUnits(a.path, b.path));
}
