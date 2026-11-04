// The spellings a project's own files and romlift's default names share across layers (architecture §6.2, §6.5,
// D75 g): defined once here, so core/config, core/model, core/scaffold and the shell cannot drift apart. Also the
// project paths of the C stubs (D77 h): the directory of a module's chunk files (and, since phase 6, of its decompiled
// functions' under asm/matchings, D92), the chunk file an INCLUDE_ASM names, and the header that defines the macro,
// which foundation/asm/dialect.ts, core/model, core/reconcile and core/scaffold share (core/reconcile imports only
// foundation).
import { hex } from './hex.ts';

/** The user's ROM at a project's root, whatever name `init` was given: the config's [rom] path and the only file an `.incbin` reads. */
export const BASEROM_FILE = 'baserom.gba';

/** romlift's config file, as `init` names it and decomp.yaml's `tools.romlift.config` points to it. */
export const ROMLIFT_CONFIG_FILE = 'romlift.toml';

/** The settings file the tools look for in a project's root. */
export const DECOMP_YAML_FILE = 'decomp.yaml';

/** The names a project's settings file may have, in the order they are looked for (the decomp_settings spec allows both). */
export const DECOMP_YAML_NAMES: readonly string[] = [DECOMP_YAML_FILE, 'decomp.yml'];

// The default names romlift gives what a config does not name, and their one parser: every spelling and the pattern
// that reads them back live here, so core/config (a new function's name) and core/model (labels, chunks, the name
// source) cannot drift apart (architecture-r1-2).

/** The default name of a function: sub_ and eight upper-case hex digits. */
export function defaultFunctionName(addr: number): string {
  return `sub_${hex(addr)}`;
}

/** The default name of the bytes between functions (an orphan chunk): unk_ and eight upper-case hex digits. */
export function orphanName(addr: number): string {
  return `unk_${hex(addr)}`;
}

/** The default name of a local, pool or table label: _ and eight upper-case hex digits. */
export function localName(addr: number): string {
  return `_${hex(addr)}`;
}

/** The default name of a data label: gUnk_ and eight upper-case hex digits. */
export function dataName(addr: number): string {
  return `gUnk_${hex(addr)}`;
}

/** Every default spelling above (sub_, unk_, _, gUnk_), with the address's eight hex digits captured. */
const DEFAULT_SPELLING = /^(?:sub|unk|gUnk)?_([0-9A-F]{8})$/;

/** Whether `name` is one of romlift's default spellings (any address). */
export function isDefaultSpelling(name: string): boolean {
  return DEFAULT_SPELLING.test(name);
}

/** The address a default spelling encodes (`sub_08000100` is 0x08000100), or undefined for any other name. */
export function defaultSpellingAddress(name: string): number | undefined {
  const digits = DEFAULT_SPELLING.exec(name)?.[1];
  return digits === undefined ? undefined : Number.parseInt(digits, 16);
}

/** The root of every module's function and orphan files: an `INCLUDE_ASM` statement names `<root>/<module>`. */
export const NONMATCHINGS_ROOT = 'asm/nonmatchings';

/** The directory of a module's function and orphan files, without a trailing '/': what its INCLUDE_ASM statements name. */
export function nonmatchingDir(module: string): string {
  return `${NONMATCHINGS_ROOT}/${module}`;
}

/**
 * The root of the chunk files of decompiled functions (architecture §6.3, phase 6, D92): a function that its C module's
 * source defines for the default build is written to `<root>/<module>/<Name>.s` instead of NONMATCHINGS_ROOT, so the
 * tree shows which functions are done. No INCLUDE_ASM statement ever names it.
 */
export const MATCHINGS_ROOT = 'asm/matchings';

/** The directory of a module's decompiled functions' chunk files, without a trailing '/'. */
export function matchingDir(module: string): string {
  return `${MATCHINGS_ROOT}/${module}`;
}

/**
 * The chunk file `file` (`asm/nonmatchings/<module>/<name>.s`) as a decompiled function's, under MATCHINGS_ROOT with the
 * same module directory and base name; any other path as it is.
 */
export function matchingFileOf(file: string): string {
  return file.startsWith(`${NONMATCHINGS_ROOT}/`) ? `${MATCHINGS_ROOT}/${file.slice(NONMATCHINGS_ROOT.length + 1)}` : file;
}

/**
 * matchingFileOf's inverse: a decompiled function's chunk file (`asm/matchings/<module>/<name>.s`) at the path the model
 * gives its chunk, under NONMATCHINGS_ROOT, where the reconciliation and the checks read chunk files; any other path as it is.
 */
export function nonmatchingFileOf(file: string): string {
  return file.startsWith(`${MATCHINGS_ROOT}/`) ? `${NONMATCHINGS_ROOT}/${file.slice(MATCHINGS_ROOT.length + 1)}` : file;
}

/** The extension of a chunk file. */
const CHUNK_FILE_EXTENSION = '.s';

/** The chunk file `INCLUDE_ASM("<dir>", <name>);` includes, and the file a chunk named `name` is written to in `dir`. */
export function chunkFileOf(dir: string, name: string): string {
  return `${dir}/${name}${CHUNK_FILE_EXTENSION}`;
}

/** Whether a file name (or path) has a chunk file's extension: what a reader of the tree on disk lists. */
export function isChunkFile(name: string): boolean {
  return name.endsWith(CHUNK_FILE_EXTENSION);
}

/**
 * chunkFileOf's inverse: the base name an INCLUDE_ASM statement names for chunk file `file` (`<dir>/<name>.s` ->
 * `<name>`): the file's last path segment without its extension.
 */
export function stubNameOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith(CHUNK_FILE_EXTENSION) ? base.slice(0, -CHUNK_FILE_EXTENSION.length) : base;
}

/**
 * The tool-owned roots of a project (architecture §6.4): a path absent from the manifest that exists on disk with other
 * content is overwritten only under one of them, and no hand-written source may lie under one (D109). A root ending in
 * '/' is a directory; the others are files.
 */
export const GENERATED_ROOTS: readonly string[] = ['asm/', 'data/', 'expected/', 'ldscript.txt', 'symbols.ld', 'modules.mk', 'objdiff.json'];

/** Whether `path` lies under one of GENERATED_ROOTS. */
export function underGeneratedRoot(path: string): boolean {
  return GENERATED_ROOTS.some((root) => (root.endsWith('/') ? path.startsWith(root) : path === root));
}

/** The directory of a project's C sources: `src/<module>.c`, the only C files romlift reads (directly under it). */
export const C_SOURCE_DIR = 'src';

/** The extension of a C source. */
const C_SOURCE_EXTENSION = '.c';

/** Whether a file name (or path) is a C source's: what a reader of `src/` lists, and a C module's build unit. */
export function isCSource(name: string): boolean {
  return name.endsWith(C_SOURCE_EXTENSION);
}

/** The extension of a C header. */
const HEADER_EXTENSION = '.h';

/**
 * Whether a file name (or path) is a C header's: a `.h` under `src/` that the shell reads beside `include/`, and an
 * unread quoted include the C reconciliation does not report as an unread `src/*.c` fragment (fix round 12,
 * architecture-d1-3: the one definition both layers use).
 */
export function isHeaderPath(name: string): boolean {
  return name.endsWith(HEADER_EXTENSION);
}

/** The project path of the C source called `name` (a file name directly under C_SOURCE_DIR, extension included). */
export function cSourceOf(name: string): string {
  return `${C_SOURCE_DIR}/${name}`;
}

/** The include directory of a project: the Makefile's `-I include`, through which `src/<module>.c` finds its header. */
export const INCLUDE_DIR = 'include';

/** The header that defines INCLUDE_ASM, as `src/<module>.c` includes it (relative to INCLUDE_DIR). */
export const INCLUDE_ASM_HEADER_NAME = 'include_asm.h';

/** The project path of the header that defines INCLUDE_ASM. */
export const INCLUDE_ASM_HEADER_PATH = `${INCLUDE_DIR}/${INCLUDE_ASM_HEADER_NAME}`;
