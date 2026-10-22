// What the one-shot commands read before a workflow runs (architecture §2.1, §6.4 step 3, D17, D36): a project (its
// decomp.yaml through locateProject, its romlift.toml through loadConfig, its ROM through readRom, every src/*.c),
// the write state planWrites needs of a directory (the disk snapshot, the manifest, the journal), the package's own
// scaffold inputs (the templates through readTemplates, the agbcc pin, the romlift version from package.json), and
// what `init`'s directory holds. Mechanical: it reads, hashes and reports; every decision is a workflow's or
// planWrites' (whether `init` may write in a directory is core/workflow/init.ts's). Each refusal is a diagnostic:
// E_PROJECT_NOT_FOUND, E_IO_READ, E_DECOMP_YAML_INVALID, the config's parse codes.
import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { chunkFileOf, C_SOURCE_DIR, cSourceOf, INCLUDE_DIR, isChunkFile, isCSource, nonmatchingDir, NONMATCHINGS_ROOT, stubNameOf } from '../../foundation/util/project-files.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { AgbccPin, ScaffoldTemplates } from '../../core/scaffold/vars.ts';
import type { ProjectInputs } from '../../core/workflow/types.ts';
import type { ProjectWriteState } from '../../core/write-plan/project-plan.ts';
import type { InitDirListing } from '../../core/workflow/init.ts';
import { ShellCodes } from '../codes.ts';
import { loadConfig } from '../config/load.ts';
import type { ProjectConfig } from '../config/load.ts';
import { errnoOf, errorReason, isDirectory, listDir } from '../fs.ts';
import type { IoResult } from '../fs.ts';
import { readRom } from '../rom.ts';
import { filesUnder, readDiskState, readJournal, readManifest, readReconciledTexts } from './disk-state.ts';
import { sha1Of } from '../hash.ts';
import { locateProject } from './locate.ts';
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
  const src = join(dir, C_SOURCE_DIR);
  try {
    if (!(await stat(src)).isDirectory()) return { ok: true, value: new Map() };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return { ok: true, value: new Map() };
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot examine ${src}: ${errorReason(error)}`, { path: src })] };
  }
  const names = await listDir(src);
  if (!names.ok) return fromIo(names);
  const paths = names.value.filter(isCSource).map(cSourceOf);
  return fromIo(await readReconciledTexts(dir, paths));
}

/**
 * Every file under the project's include/ and every `.h` under its src/, at any depth, keyed by project path (fix
 * round 10, correctness-c2-1; src/ since fix round 11, correctness-d0-2): the headers the C reconciliation follows, as
 * the scaffold's `cpp -nostdinc -I include` finds them, to learn whether a file's includes already define INCLUDE_ASM
 * (IncludeAsmWanted.headers). Listed by disk-state's filesUnder, so a symbolic link is never followed into a directory:
 * a link to a file is read as that file, and one to a directory (EISDIR) or to nothing (ENOENT) is left out. Empty
 * when neither directory exists; any other failure to list or read is E_IO_READ.
 */
export async function readHeaderTexts(dir: string): Promise<ReadResult<ReadonlyMap<string, string>>> {
  const headers: string[] = [];
  const listedHeaders = await filesUnder(dir, INCLUDE_DIR, headers);
  if (!listedHeaders.ok) return fromIo(listedHeaders);
  const sources: string[] = [];
  const listedSources = await filesUnder(dir, C_SOURCE_DIR, sources);
  if (!listedSources.ok) return fromIo(listedSources);
  const paths = [...headers.filter((p) => p.startsWith(`${INCLUDE_DIR}/`)), ...sources.filter((p) => p.startsWith(`${C_SOURCE_DIR}/`) && p.endsWith('.h'))];
  const out = new Map<string, string>();
  for (const path of paths.sort(compareCodeUnits)) {
    const file = join(dir, ...path.split('/'));
    try {
      out.set(path, await readFile(file, 'utf8'));
    } catch (error) {
      if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'EISDIR') continue;
      return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${file}: ${errorReason(error)}`, { path })] };
    }
  }
  return { ok: true, value: out };
}

/**
 * The project paths of the chunk files under the project's asm/nonmatchings/ (`asm/nonmatchings/<module>/<name>.s`,
 * one level of module directories), in code-unit order: the tree romlift last generated, which the C
 * reconciliation reads (D78 a). Empty when there is no such directory.
 */
export async function readChunkFiles(dir: string): Promise<ReadResult<readonly string[]>> {
  const root = join(dir, ...NONMATCHINGS_ROOT.split('/'));
  const present = await isDirectory(root);
  if (!present.ok) return fromIo(present);
  if (!present.value) return { ok: true, value: [] };
  const modules = await listDir(root);
  if (!modules.ok) return fromIo(modules);
  const out: string[] = [];
  for (const module of modules.value) {
    const isModule = await isDirectory(join(root, module));
    if (!isModule.ok) return fromIo(isModule);
    if (!isModule.value) continue;
    const names = await listDir(join(root, module));
    if (!names.ok) return fromIo(names);
    for (const name of names.value) if (isChunkFile(name)) out.push(chunkFileOf(nonmatchingDir(module), stubNameOf(name)));
  }
  return { ok: true, value: out };
}

/**
 * The project that holds `from` (a directory): located (decomp.yaml), its config loaded and parsed, its ROM read
 * (the config's `[rom] path` under the project, or `options.rom` resolved from `from`), and its C texts with the chunk
 * files on disk (readChunkFiles) and the headers under include/ and src/ (readHeaderTexts).
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
  let previousChunkFiles: readonly string[] | undefined;
  let headerTexts: ReadonlyMap<string, string> | undefined;
  if (options.withoutC !== true) {
    const read = await readCTexts(dir);
    if (!read.ok) return read;
    cTexts = read.value;
    const chunks = await readChunkFiles(dir);
    if (!chunks.ok) return chunks;
    previousChunkFiles = chunks.value;
    const headers = await readHeaderTexts(dir);
    if (!headers.ok) return headers;
    headerTexts = headers.value;
  }
  const inputs: ProjectInputs = { rom: rom.value, configText: loaded.value.text, config: loaded.value.value, configSha1: loaded.value.sha1, cTexts, ...(previousChunkFiles === undefined ? {} : { previousChunkFiles }), ...(headerTexts === undefined ? {} : { headerTexts }) };
  return { ok: true, value: { dir, config: loaded.value, romPath, inputs } };
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
// init's directory: read here, judged by core/workflow/init.ts (initDirVerdict, replacedProblems).

/**
 * What `init` finds where it is to write (InitDirListing): the directory, absolute, whether it exists as a directory,
 * its entry names, and the ROM's name when the ROM lies directly in it. Decides nothing.
 */
export async function readInitDir(dir: string, romPath: string): Promise<ReadResult<InitDirListing>> {
  const at = resolve(dir);
  const inside = relative(at, resolve(romPath));
  const romInside = inside !== '' && !inside.startsWith('..') && !inside.includes(sep) ? inside : undefined;
  const base = { dir: at, ...(romInside === undefined ? {} : { romInside }) };
  try {
    if (!(await stat(at)).isDirectory()) return { ok: true, value: { ...base, state: 'not-directory', names: [] } };
  } catch (error) {
    if (errnoOf(error) === 'ENOENT') return { ok: true, value: { ...base, state: 'absent', names: [] } };
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot examine ${at}: ${errorReason(error)}`, { path: at })] };
  }
  const names = await listDir(at);
  if (!names.ok) return fromIo(names);
  return { ok: true, value: { ...base, state: 'directory', names: names.value } };
}

/** The sha1 of each project path of `paths` under `dir`, or 'absent' (replacedProblems compares them). */
export async function readDigests(dir: string, paths: Iterable<string>): Promise<ReadResult<ReadonlyMap<string, string | 'absent'>>> {
  const out = new Map<string, string | 'absent'>();
  for (const path of paths) {
    try {
      out.set(path, sha1Of(await readFile(join(dir, ...path.split('/')))));
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${join(dir, path)}: ${errorReason(error)}`, { path })] };
      out.set(path, 'absent');
    }
  }
  return { ok: true, value: out };
}
