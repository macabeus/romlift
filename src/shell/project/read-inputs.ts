// What the one-shot commands read before a workflow runs (architecture §2.1, §6.4 step 3, D17, D36): a project (its
// decomp.yaml through locateProject, its romlift.toml through loadConfig, its ROM through readRom, every src/*.c),
// the write state planWrites needs of a directory (the disk snapshot, the manifest, the journal), the package's own
// scaffold inputs (the templates through readTemplates, the agbcc pin, the romlift version from package.json), and
// whether a directory may receive `init`. Mechanical: it reads, hashes and reports; every decision is a workflow's or
// planWrites'. Each refusal is a diagnostic: E_PROJECT_NOT_FOUND, E_IO_READ, E_DECOMP_YAML_INVALID, the config's
// parse codes, E_DIR_NOT_EMPTY.
import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { DECOMP_YAML_FILE, ROMLIFT_CONFIG_FILE } from '../../core/config/decomp-yaml.ts';
import { SCAFFOLD_ROM_FILE } from '../../core/scaffold/vars.ts';
import type { AgbccPin, ScaffoldTemplates } from '../../core/scaffold/vars.ts';
import type { ProjectInputs } from '../../core/workflow/types.ts';
import type { ProjectWriteState } from '../../core/workflow/generate.ts';
import { ROMLIFT_DIR } from '../../core/write-plan/types.ts';
import { ShellCodes } from '../codes.ts';
import { loadConfig } from '../config/load.ts';
import type { ProjectConfig } from '../config/load.ts';
import { errnoOf, errorReason, listDir } from '../fs.ts';
import type { IoResult } from '../fs.ts';
import { readRom } from '../rom.ts';
import { readDiskState, readJournal, readManifest, readReconciledTexts } from './disk-state.ts';
import { DECOMP_YAML_NAMES, locateProject } from './locate.ts';
import { readAgbccPin, readTemplates } from './templates.ts';

/** A refusal: every diagnostic that stopped the read. */
export type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function fromIo<T>(read: IoResult<T>): ReadResult<T> {
  return read.ok ? read : { ok: false, diagnostics: [read.diagnostic] };
}

/** `path` resolved against `base` (a command's working directory, which is not always the process's). */
export function resolveFrom(base: string, path: string): string {
  return resolve(base, path);
}

// ---------------------------------------------------------------------------------------------------
// The package.

/** romlift's package directory: three levels above this file, in src/ (development) and in dist/ (installed) alike. */
export function packageRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

/** What `init` and `scaffold --diff` render the scaffold from: the package's templates, its agbcc pin and its version. */
export interface ScaffoldInputs {
  readonly templates: ScaffoldTemplates;
  readonly agbcc: AgbccPin;
  readonly romliftVersion: string;
}

/** The `version` of `<root>/package.json`. */
export async function packageVersion(root: string = packageRoot()): Promise<IoResult<string>> {
  const file = join(root, 'package.json');
  try {
    const json: unknown = JSON.parse(await readFile(file, 'utf8'));
    const version = typeof json === 'object' && json !== null && 'version' in json ? json.version : undefined;
    if (typeof version === 'string' && version !== '') return { ok: true, value: version };
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_READ', `${file} has no version`, { path: file }) };
  } catch (error) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${file}: ${errorReason(error)}`, { path: file }) };
  }
}

/** The scaffold inputs of the package at `root` (default the running romlift's). */
export async function readScaffoldInputs(root: string = packageRoot()): Promise<ReadResult<ScaffoldInputs>> {
  const templates = await readTemplates(root);
  if (!templates.ok) return fromIo(templates);
  const agbcc = await readAgbccPin(root);
  if (!agbcc.ok) return fromIo(agbcc);
  const version = await packageVersion(root);
  if (!version.ok) return fromIo(version);
  return { ok: true, value: { templates: templates.value, agbcc: agbcc.value, romliftVersion: version.value } };
}

// ---------------------------------------------------------------------------------------------------
// A project.

/** A project as the commands read it: where it is, its config as loadConfig read it, and the workflow inputs. */
export interface ReadProject {
  /** The project directory, absolute. */
  readonly dir: string;
  readonly config: ProjectConfig;
  /** The ROM file read, absolute. */
  readonly romPath: string;
  readonly inputs: ProjectInputs;
}

export interface ReadProjectOptions {
  /** Read this ROM instead of the config's `[rom] path` (`generate --rom`: a worktree without the ROM). */
  readonly rom?: string;
  /** Skip the src/*.c texts (a command that emits no tree reads none). */
  readonly withoutC?: boolean;
}

/** Every `src/<name>.c` directly under the project's src/, keyed by project path, in code-unit order. */
export async function readCTexts(dir: string): Promise<ReadResult<ReadonlyMap<string, string>>> {
  const src = join(dir, 'src');
  try {
    if (!(await stat(src)).isDirectory()) return { ok: true, value: new Map() };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return { ok: true, value: new Map() };
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot examine ${src}: ${errorReason(error)}`, { path: src })] };
  }
  const names = await listDir(src);
  if (!names.ok) return fromIo(names);
  const paths = names.value.filter((name) => name.endsWith('.c')).map((name) => `src/${name}`);
  return fromIo(await readReconciledTexts(dir, paths));
}

/**
 * The project that holds `from` (a directory): located (decomp.yaml), its config loaded and parsed, its ROM read
 * (the config's `[rom] path` under the project, or `options.rom` resolved from `from`), and its C texts.
 */
export async function readProject(from: string, options: ReadProjectOptions = {}): Promise<ReadResult<ReadProject>> {
  const located = await locateProject(from);
  if (!located.ok) return located;
  const loaded = await loadConfig(located.value.dir);
  if (!loaded.ok) return loaded;
  const dir = loaded.value.dir;
  const romPath = options.rom === undefined ? join(dir, ...loaded.value.value.rom.path.split('/')) : resolve(from, options.rom);
  const rom = await readRom(romPath);
  if (!rom.ok) return fromIo(rom);
  let cTexts: ReadonlyMap<string, string> = new Map();
  if (options.withoutC !== true) {
    const read = await readCTexts(dir);
    if (!read.ok) return read;
    cTexts = read.value;
  }
  return {
    ok: true,
    value: { dir, config: loaded.value, romPath, inputs: { rom: rom.value, configText: loaded.value.text, config: loaded.value.value, cTexts } },
  };
}

/**
 * What planWrites needs of the directory `dir` a tree is written into: its manifest and journal (an interrupted
 * run's), and the sha1 of every path of `paths`, of every manifest and journal path, and of every file under the
 * generated roots.
 */
export async function readWriteState(dir: string, paths: Iterable<string>): Promise<ReadResult<ProjectWriteState>> {
  const manifest = await readManifest(dir);
  if (!manifest.ok) return fromIo(manifest);
  const journal = await readJournal(dir);
  if (!journal.ok) return fromIo(journal);
  const wanted = new Set(paths);
  for (const path of Object.keys(manifest.value?.files ?? {})) wanted.add(path);
  for (const op of journal.value?.ops ?? []) wanted.add(op.path);
  const disk = await readDiskState(dir, wanted);
  if (!disk.ok) return fromIo(disk);
  return { ok: true, value: { manifest: manifest.value, journal: journal.value, disk: disk.value, reconciledTexts: new Map() } };
}

/** The current text of each project path of `paths` under `dir` that exists (`scaffold --diff` compares them). */
export async function readProjectTexts(dir: string, paths: Iterable<string>): Promise<ReadResult<ReadonlyMap<string, string>>> {
  return fromIo(await readReconciledTexts(dir, paths));
}

// ---------------------------------------------------------------------------------------------------
// init's directory.

/** What `init` found in its directory. */
export interface InitDir {
  /** The directory, absolute; it may not exist yet. */
  readonly dir: string;
  /** It already is a romlift project (decomp.yaml, romlift.toml or .romlift/ in it). */
  readonly project: boolean;
  /** The ROM `init` was given, as a project path, when it lies inside `dir`; else undefined. */
  readonly romInside?: string;
}

/** Whether a directory entry belongs to a romlift project. */
function projectEntry(name: string): boolean {
  return DECOMP_YAML_NAMES.includes(name) || name === ROMLIFT_CONFIG_FILE || name === ROMLIFT_DIR;
}

/**
 * Whether `dir` may receive `init <rom>` (architecture §2.1): it is absent or empty, it holds only the given ROM
 * plus `.git` and dot-files, or it is a romlift project; anything else is E_DIR_NOT_EMPTY, naming what it holds.
 */
export async function readInitDir(dir: string, romPath: string): Promise<ReadResult<InitDir>> {
  const at = resolve(dir);
  const rom = resolve(romPath);
  const inside = relative(at, rom);
  const romInside = inside !== '' && !inside.startsWith('..') && !inside.includes(sep) ? inside : undefined;
  try {
    if (!(await stat(at)).isDirectory()) {
      return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_DIR_NOT_EMPTY', `${at} is a file, not a directory`, { path: at })] };
    }
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return { ok: true, value: { dir: at, project: false, ...(romInside === undefined ? {} : { romInside }) } };
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot examine ${at}: ${errorReason(error)}`, { path: at })] };
  }
  const names = await listDir(at);
  if (!names.ok) return fromIo(names);
  const project = names.value.some(projectEntry);
  const others = names.value.filter((name) => !name.startsWith('.') && name !== romInside);
  if (!project && others.length > 0) {
    const shown = others.slice(0, 5).join(', ') + (others.length > 5 ? `, … (${others.length} in all)` : '');
    const message = `${at} is not empty and is not a romlift project: it holds ${shown}; run init in an empty directory, or one that holds only the ROM`;
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_DIR_NOT_EMPTY', message, { path: at })] };
  }
  return { ok: true, value: { dir: at, project, ...(romInside === undefined ? {} : { romInside }) } };
}

/**
 * E_DIR_NOT_EMPTY when `init` would replace a file of an existing project with other content: romlift.toml (the
 * user's config from then on), decomp.yaml or baserom.gba. `files` maps each project path to the text or bytes
 * init would write there; a file that is absent or already equal is fine.
 */
export async function checkReplaced(dir: string, files: ReadonlyMap<string, string | Uint8Array>): Promise<ReadResult<void>> {
  const problems: Diagnostic[] = [];
  for (const [path, wanted] of files) {
    let current: Buffer;
    try {
      current = await readFile(join(dir, ...path.split('/')));
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') continue;
      problems.push(diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${join(dir, path)}: ${errorReason(error)}`, { path }));
      continue;
    }
    const same = typeof wanted === 'string' ? current.toString('utf8') === wanted : Buffer.compare(current, Buffer.from(wanted.buffer, wanted.byteOffset, wanted.byteLength)) === 0;
    if (same) continue;
    const hint = path === ROMLIFT_CONFIG_FILE || path === DECOMP_YAML_FILE ? 'run `romlift generate` to regenerate the tree from it, or remove it to start over' : `it is another ROM; remove ${SCAFFOLD_ROM_FILE} to start over`;
    problems.push(diagnostic(ShellCodes, 'E_DIR_NOT_EMPTY', `${dir} is a romlift project whose ${path} differs from what init would write: ${hint}`, { path }));
  }
  return problems.length > 0 ? { ok: false, diagnostics: problems } : { ok: true, value: undefined };
}
