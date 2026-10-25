// What the one-shot commands read before a workflow runs (architecture §2.1, §6.4 step 3, D17, D36): a project (its
// decomp.yaml through locateProject, its romlift.toml through loadConfig, its ROM through readRom, every src/*.c),
// the write state planWrites needs of a directory (the disk snapshot, the manifest, the journal), the package's own
// scaffold inputs (the templates through readTemplates, the agbcc pin, the romlift version from package.json), and
// what `init`'s directory holds. Mechanical: it reads, hashes and reports; every decision is a workflow's or
// planWrites' (whether `init` may write in a directory is core/workflow/init.ts's). Each refusal is a diagnostic:
// E_PROJECT_NOT_FOUND, E_IO_READ, E_DECOMP_YAML_INVALID, the config's parse codes.
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { headerCandidates, includesOf } from '../../core/reconcile/c-scan.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { chunkFileOf, C_SOURCE_DIR, cSourceOf, INCLUDE_DIR, isChunkFile, isCSource, isHeaderPath, matchingDir, MATCHINGS_ROOT, nonmatchingDir, NONMATCHINGS_ROOT, stubNameOf } from '../../foundation/util/project-files.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { AgbccPin, ScaffoldTemplates } from '../../core/scaffold/vars.ts';
import type { ProjectInputs } from '../../core/workflow/types.ts';
import type { ProjectWriteState } from '../../core/write-plan/project-plan.ts';
import type { DiskFileState } from '../../core/write-plan/types.ts';
import type { InitDirListing } from '../../core/workflow/init.ts';
import type { RenameSkipped } from '../../core/workflow/rename.ts';
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

/** The headers the C reconciliation follows (ProjectInputs.headerTexts) and where they are (ProjectInputs.headerRealPaths). */
export interface HeaderInputs {
  /** Each header's text, by key, in code-unit order. */
  readonly texts: ReadonlyMap<string, string>;
  /** Each header's and C file's directory's real path with its name (c-scan.ts IncludeRealPaths), where it is not its key. */
  readonly realPaths: ReadonlyMap<string, string>;
}

/**
 * The headers the C reconciliation follows to learn whether a file's includes already define INCLUDE_ASM
 * (IncludeAsmWanted.headers; fix round 10, correctness-c2-1), read as the scaffold's `cpp -nostdinc -I include` finds
 * them (phase 6; roadmap "Carried from phase 4": D89 a, D90 a, gate-honesty-e1-1):
 * - every file under the project's include/ and every `.h` under its src/, at any depth, keyed by project path (src/
 *   since fix round 11, correctness-d0-2), listed by disk-state's filesUnder with `followLinks`: a link to a file is
 *   read as that file, a link to a directory (include/ or src/ itself among them) is walked under its own project path
 *   (fix round 12, correctness-d1-1), but not one to the project directory, to a directory the walk is inside or to
 *   one above the project;
 * - then every file an `#include` of a C file (`cTexts`) or of a header read names (c-scan.ts includesOf), transitively:
 *   the first of its candidates (headerCandidates: a quoted include from the including file's real directory, then
 *   include/; an angle one from include/) that is a regular file, keyed by that candidate. So behind a link the walk
 *   does not enter (`include -> .`, `include/up -> ../..`, `src/up -> ../..`) exactly the files an `#include` names are
 *   read, and a `..` behind a linked directory reaches the parent of its target, as cpp's.
 * `realPaths` gives each header's, and each C file's, directory's real path with its own name where it differs from
 * the key (relative to the project inside it, absolute outside). A dangling link, a missing candidate and a FIFO, a
 * socket or a device, which reading would block on, are left out (only regular files are read, gate-honesty-e1-2).
 * Empty when neither directory exists and no `#include` names a file; any other failure to list or read a header the
 * walk lists or an `#include` names is E_IO_READ.
 */
export async function readHeaderTexts(dir: string, cTexts: ReadonlyMap<string, string> = new Map()): Promise<ReadResult<HeaderInputs>> {
  const headers: string[] = [];
  const listedHeaders = await filesUnder(dir, INCLUDE_DIR, headers, { followLinks: true });
  if (!listedHeaders.ok) return fromIo(listedHeaders);
  const sources: string[] = [];
  const listedSources = await filesUnder(dir, C_SOURCE_DIR, sources, { followLinks: true });
  if (!listedSources.ok) return fromIo(listedSources);
  const paths = [...headers.filter((p) => p.startsWith(`${INCLUDE_DIR}/`)), ...sources.filter((p) => p.startsWith(`${C_SOURCE_DIR}/`) && isHeaderPath(p))];
  let root: string;
  try {
    root = await realpath(dir);
  } catch (error) {
    return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot resolve ${dir}: ${errorReason(error)}`, { path: dir })] };
  }
  const texts = new Map<string, string>();
  const realPaths = new Map<string, string>();
  const dirs = new Map<string, string>();
  const place = async (key: string): Promise<ReadResult<void>> => {
    const real = await realPathOf(keyOnDisk(dir, root, key), key, root, dirs);
    if (!real.ok) return fromIo(real);
    if (real.value !== key) realPaths.set(key, real.value);
    return { ok: true, value: undefined };
  };
  for (const path of paths.sort(compareCodeUnits)) {
    const file = join(dir, ...path.split('/'));
    try {
      texts.set(path, await readFile(file, 'utf8'));
    } catch (error) {
      if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'EISDIR') continue;
      return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${file}: ${errorReason(error)}`, { path })] };
    }
    const placed = await place(path);
    if (!placed.ok) return placed;
  }
  const cPaths = [...cTexts.keys()].sort(compareCodeUnits);
  for (const path of cPaths) {
    const placed = await place(path);
    if (!placed.ok) return placed;
  }
  // The files the #include lines name, each from the first candidate cpp would open (headerCandidates).
  const pending = [...cPaths, ...texts.keys()];
  for (let from = pending.shift(); from !== undefined; from = pending.shift()) {
    for (const include of includesOf(texts.get(from) ?? cTexts.get(from) ?? '')) {
      for (const candidate of headerCandidates(from, include.spelled, include.angle, realPaths)) {
        if (texts.has(candidate)) break;
        const read = cTexts.has(candidate) ? { ok: true as const, value: cTexts.get(candidate) } : await readNamed(keyOnDisk(dir, root, candidate), candidate);
        if (!read.ok) return fromIo(read);
        if (read.value === undefined) continue;
        texts.set(candidate, read.value);
        const placed = await place(candidate);
        if (!placed.ok) return placed;
        pending.push(candidate);
        break;
      }
    }
  }
  const sorted = new Map([...texts].sort(([a], [b]) => compareCodeUnits(a, b)));
  return { ok: true, value: { texts: sorted, realPaths: new Map([...realPaths].sort(([a], [b]) => compareCodeUnits(a, b))) } };
}

/**
 * The path a header key names on disk, as cpp opens it: an absolute key as it is, any other under the project directory
 * `dir`, joined as written (no `..` resolved before the system resolves it behind a link: headerCandidates keeps a
 * `..` after a named directory); a key that leads above the project (`../x.h`) from the project's real path `root`.
 */
function keyOnDisk(dir: string, root: string, key: string): string {
  if (isAbsolute(key)) return key;
  return `${key.startsWith('../') ? root : dir}${sep}${key.split('/').join(sep)}`;
}

/**
 * The text of the file at `file` an `#include` names (`key`), or undefined when there is none or it is no regular file
 * (a directory, a FIFO, a socket, a device: cpp reads no directory, and a FIFO would block, gate-honesty-e1-2); a
 * failure to examine or read it is E_IO_READ.
 */
async function readNamed(file: string, key: string): Promise<IoResult<string | undefined>> {
  try {
    if (!(await stat(file)).isFile()) return { ok: true, value: undefined };
    return { ok: true, value: await readFile(file, 'utf8') };
  } catch (error) {
    const code = errnoOf(error);
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'ENAMETOOLONG') return { ok: true, value: undefined };
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${file}: ${errorReason(error)}`, { path: key }) };
  }
}

/**
 * Where the file at `file` (key `key`) is behind its symbolic links (c-scan.ts IncludeRealPaths): its directory's real
 * path (realpath, cached in `dirs` by directory) with its own name, relative to the project's real path `root` inside
 * it, absolute outside; the key itself when its directory is gone (a C file removed since it was read).
 */
async function realPathOf(file: string, key: string, root: string, dirs: Map<string, string>): Promise<IoResult<string>> {
  const parent = dirname(file);
  let real = dirs.get(parent);
  if (real === undefined) {
    try {
      real = await realpath(parent);
    } catch (error) {
      if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return { ok: true, value: key };
      return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_READ', `cannot resolve ${parent}: ${errorReason(error)}`, { path: key }) };
    }
    dirs.set(parent, real);
  }
  const name = basename(file);
  const down = relative(root, real);
  if (down === '') return { ok: true, value: name };
  if (isAbsolute(down) || down.split(sep)[0] === '..') return { ok: true, value: `${real.split(sep).join('/')}/${name}` };
  return { ok: true, value: `${down.split(sep).join('/')}/${name}` };
}

/**
 * The project paths of the chunk files under the project's asm/nonmatchings/ and asm/matchings/
 * (`<root>/<module>/<name>.s`, one level of module directories; asm/matchings holds the decompiled functions' since
 * phase 6, D92), in code-unit order: the tree romlift last generated, which the C reconciliation reads (D78 a). Empty
 * when there is no such directory.
 */
export async function readChunkFiles(dir: string): Promise<ReadResult<readonly string[]>> {
  const out: string[] = [];
  for (const [rootPath, dirOf] of [
    [MATCHINGS_ROOT, matchingDir],
    [NONMATCHINGS_ROOT, nonmatchingDir],
  ] as const) {
    const root = join(dir, ...rootPath.split('/'));
    const present = await isDirectory(root);
    if (!present.ok) return fromIo(present);
    if (!present.value) continue;
    const modules = await listDir(root);
    if (!modules.ok) return fromIo(modules);
    for (const module of modules.value) {
      const isModule = await isDirectory(join(root, module));
      if (!isModule.ok) return fromIo(isModule);
      if (!isModule.value) continue;
      const names = await listDir(join(root, module));
      if (!names.ok) return fromIo(names);
      for (const name of names.value) if (isChunkFile(name)) out.push(chunkFileOf(dirOf(module), stubNameOf(name)));
    }
  }
  return { ok: true, value: out };
}

/** What `rename` edits: every text it may rename identifiers in, the sha1 of each one's bytes, and what it left out. */
export interface RenameTexts {
  readonly texts: ReadonlyMap<string, string>;
  readonly sha1s: ReadonlyMap<string, string>;
  /** The files under src/ and include/ it does not edit, with why and, for a file, its bytes (planRename decides). */
  readonly skipped: readonly RenameSkipped[];
}

/** UTF-8, refusing a byte sequence that is not, and keeping a leading byte order mark (its bytes are hashed). */
const RENAME_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Whether project path `path` is a text rename reads: a `.c` or `.h` under src/, or any file under include/. */
function isRenameText(path: string): boolean {
  if (path.startsWith(`${INCLUDE_DIR}/`)) return true;
  return path.startsWith(`${C_SOURCE_DIR}/`) && (isCSource(path) || isHeaderPath(path));
}

/**
 * The bytes behind a symbolic link to a regular file, or undefined for a link to no file: one to a directory or another
 * kind of file, a dangling link (ENOENT, ENOTDIR) or a loop (ELOOP), the rule of shell/fs.ts isRegularFile. Any other
 * failure (EACCES, EIO) is thrown for readRenameTexts to report as E_IO_READ, never read as a link to nothing
 * (architecture-r1-1): a target that cannot be read may name the old name.
 */
async function linkedFileBytes(file: string): Promise<Uint8Array | undefined> {
  let isFile: boolean;
  try {
    isFile = (await stat(file)).isFile();
  } catch (error) {
    const code = errnoOf(error);
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return undefined;
    throw error;
  }
  return isFile ? await readFile(file) : undefined;
}

/**
 * The texts `rename` reads (architecture §6.6, phase 6, D92, D95 c): every `.c` and `.h` under the project's src/ and
 * every file under include/, at any depth, with the sha1 of each one's bytes (RenameTexts). What it does not edit it
 * lists in `skipped`, never silently: a symbolic link (file or directory, under src/ or include/), since an edit
 * written through a temporary file and a rename would replace the link with a file (the link's target's bytes when it
 * is a file), and a file that is not UTF-8 text or holds a NUL (a binary under include/), which an edit could not write
 * back as it was (its bytes). planRename warns of each, or refuses when one names the old name. Empty when neither
 * directory exists; any other failure to list or read is E_IO_READ.
 */
export async function readRenameTexts(dir: string): Promise<ReadResult<RenameTexts>> {
  const listed: string[] = [];
  for (const root of [C_SOURCE_DIR, INCLUDE_DIR]) {
    const under = await filesUnder(dir, root, listed);
    if (!under.ok) return fromIo(under);
  }
  const texts = new Map<string, string>();
  const sha1s = new Map<string, string>();
  const skipped: RenameSkipped[] = [];
  for (const path of [...listed].sort(compareCodeUnits)) {
    const file = join(dir, ...path.split('/'));
    let bytes: Uint8Array;
    try {
      if ((await lstat(file)).isSymbolicLink()) {
        const linked = await linkedFileBytes(file);
        if (linked === undefined || isRenameText(path)) skipped.push({ path, reason: 'link', ...(linked === undefined ? {} : { bytes: linked }) });
        continue;
      }
      if (!isRenameText(path)) continue;
      bytes = await readFile(file);
    } catch (error) {
      if (errnoOf(error) === 'ENOENT') continue;
      return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${file}: ${errorReason(error)}`, { path })] };
    }
    let text: string;
    try {
      text = RENAME_UTF8.decode(bytes);
    } catch {
      skipped.push({ path, reason: 'not-utf8', bytes });
      continue;
    }
    if (text.includes('\0')) {
      skipped.push({ path, reason: 'binary', bytes });
      continue;
    }
    texts.set(path, text);
    sha1s.set(path, sha1Of(bytes));
  }
  return { ok: true, value: { texts, sha1s, skipped } };
}

/**
 * The project that holds `from` (a directory): located (decomp.yaml), its config loaded and parsed, its ROM read
 * (the config's `[rom] path` under the project, or `options.rom` resolved from `from`), and its C texts with the chunk
 * files on disk (readChunkFiles) and the headers under include/ and src/ and those the C's includes name, with where
 * each header and C file is behind its links (readHeaderTexts: headerTexts, headerRealPaths).
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
  let headerRealPaths: ReadonlyMap<string, string> | undefined;
  if (options.withoutC !== true) {
    const read = await readCTexts(dir);
    if (!read.ok) return read;
    cTexts = read.value;
    const chunks = await readChunkFiles(dir);
    if (!chunks.ok) return chunks;
    previousChunkFiles = chunks.value;
    const headers = await readHeaderTexts(dir, cTexts);
    if (!headers.ok) return headers;
    headerTexts = headers.value.texts;
    headerRealPaths = headers.value.realPaths;
  }
  const inputs: ProjectInputs = { rom: rom.value, configText: loaded.value.text, config: loaded.value.value, configSha1: loaded.value.sha1, cTexts, ...(previousChunkFiles === undefined ? {} : { previousChunkFiles }), ...(headerTexts === undefined ? {} : { headerTexts }), ...(headerRealPaths === undefined ? {} : { headerRealPaths }) };
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

/** What is at each project path of `paths` under `dir`: a file and its sha1, or absent (replacedProblems compares them). */
export async function readDigests(dir: string, paths: Iterable<string>): Promise<ReadResult<ReadonlyMap<string, DiskFileState>>> {
  const out = new Map<string, DiskFileState>();
  for (const path of paths) {
    try {
      out.set(path, { kind: 'present', sha1: sha1Of(await readFile(join(dir, ...path.split('/')))) });
    } catch (error) {
      if (errnoOf(error) !== 'ENOENT') return { ok: false, diagnostics: [diagnostic(ShellCodes, 'E_IO_READ', `cannot read ${join(dir, path)}: ${errorReason(error)}`, { path })] };
      out.set(path, { kind: 'absent' });
    }
  }
  return { ok: true, value: out };
}
