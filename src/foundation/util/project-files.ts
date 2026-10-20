// The spellings a project's own files and romlift's default names share across layers (architecture §6.2, §6.5,
// D75 g): defined once here, so core/config, core/model, core/scaffold and the shell cannot drift apart. Also the
// project paths of the C stubs (D77 h): the directory of a module's chunk files, the chunk file an INCLUDE_ASM names,
// and the header that defines the macro, which foundation/asm/dialect.ts, core/model, core/reconcile and core/scaffold
// share (core/reconcile imports only foundation).
import { hex } from './hex.ts';

/** The user's ROM at a project's root, whatever name `init` was given: the config's [rom] path and the only file an `.incbin` reads. */
export const BASEROM_FILE = 'baserom.gba';

/** romlift's config file, as `init` names it and decomp.yaml's `tools.romlift.config` points to it. */
export const ROMLIFT_CONFIG_FILE = 'romlift.toml';

/** The settings file the tools look for in a project's root. */
export const DECOMP_YAML_FILE = 'decomp.yaml';

/** The names a project's settings file may have, in the order they are looked for (the decomp_settings spec allows both). */
export const DECOMP_YAML_NAMES: readonly string[] = [DECOMP_YAML_FILE, 'decomp.yml'];

/** The default name of a function: sub_ and eight upper-case hex digits. */
export function defaultFunctionName(addr: number): string {
  return `sub_${hex(addr)}`;
}

/** The root of every module's function and orphan files: an `INCLUDE_ASM` statement names `<root>/<module>`. */
export const NONMATCHINGS_ROOT = 'asm/nonmatchings';

/** The directory of a module's function and orphan files, without a trailing '/': what its INCLUDE_ASM statements name. */
export function nonmatchingDir(module: string): string {
  return `${NONMATCHINGS_ROOT}/${module}`;
}

/** The extension of a chunk file. */
const CHUNK_FILE_EXTENSION = '.s';

/** The chunk file `INCLUDE_ASM("<dir>", <name>);` includes, and the file a chunk named `name` is written to in `dir`. */
export function chunkFileOf(dir: string, name: string): string {
  return `${dir}/${name}${CHUNK_FILE_EXTENSION}`;
}

/**
 * chunkFileOf's inverse: the base name an INCLUDE_ASM statement names for chunk file `file` (`<dir>/<name>.s` ->
 * `<name>`): the file's last path segment without its extension.
 */
export function stubNameOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.endsWith(CHUNK_FILE_EXTENSION) ? base.slice(0, -CHUNK_FILE_EXTENSION.length) : base;
}

/** The include directory of a project: the Makefile's `-I include`, through which `src/<module>.c` finds its header. */
export const INCLUDE_DIR = 'include';

/** The header that defines INCLUDE_ASM, as `src/<module>.c` includes it (relative to INCLUDE_DIR). */
export const INCLUDE_ASM_HEADER_NAME = 'include_asm.h';

/** The project path of the header that defines INCLUDE_ASM. */
export const INCLUDE_ASM_HEADER_PATH = `${INCLUDE_DIR}/${INCLUDE_ASM_HEADER_NAME}`;
