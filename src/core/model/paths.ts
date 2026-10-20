// The project paths every writer and check shares (architecture §6.2, §6.3, D62): where each chunk and
// module is written, and the build units the linker script and the link check name. One definition, so
// the writers, the text-layout and paths checks, the write plan's `retained` prefixes and the bench
// cannot disagree on a file name.
//
// Case folding (§6.2): on a case-insensitive file system `VBlankCB.s` and `VblankCB.s` are one file, so
// every member of a group of function or orphan chunks whose names fold to the same text inside one
// directory is written `<Name>_<ADDR>.s` (ADDR: eight upper-case hex digits of its load address), never
// only the second one. core/verify/paths.ts (E_PATH_CASE_COLLISION) guards the result.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import { BASEROM_FILE, chunkFileOf, nonmatchingDir } from '../../foundation/util/project-files.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { hex } from '../../foundation/util/hex.ts';
import type { Span } from '../../foundation/rom/span.ts';
import type { Chunk, Model, Module } from './types.ts';

export const HEADER_PATH = 'asm/rom_header.s';
export const CRT0_PATH = 'asm/crt0.s';
export const LDSCRIPT_PATH = 'ldscript.txt';
export const SYMBOLS_PATH = 'symbols.ld';
/** The per-unit build variables the scaffold's Makefile includes (the modules-mk writer, D74 f). */
export const MODULES_MK_PATH = 'modules.mk';
/** The user's ROM at the project root: the config's rom.path, and the only file an `.incbin` reads. */
export const BASEROM_PATH = BASEROM_FILE;
/** The macro file every generated `.s` includes, as the dialect defines it (foundation/asm/dialect.ts DIALECT.macrosPath). */
export const MACROS_PATH = DIALECT.macrosPath;

/** The directory of a module's function and orphan files, without a trailing '/' (one definition, foundation/util/project-files.ts). */
export { nonmatchingDir };

/** The object an asm or data module builds to (as from its `.s` source). */
export function objectPath(module: string): string {
  return `build/${module}.o`;
}

/**
 * The object a C module builds to (D74 f): `src/<module>.c` is preprocessed, compiled by agbcc into
 * cAssemblyPath(module) and assembled to `build/src/<module>.o`, which the ldscript's C-data check names as
 * `*src/<module>.o`.
 */
export function cObjectPath(module: string): string {
  return `build/src/${module}.o`;
}

/** The assembly agbcc writes for C module `module`, which `as` assembles to cObjectPath(module). */
export function cAssemblyPath(module: string): string {
  return `build/src/${module}.s`;
}

/** Whether a build unit's source is a C file (moduleSource of a C module), which builds to cObjectPath. */
export function isCSource(source: string): boolean {
  return source.endsWith('.c');
}

function isFileChunk(chunk: Chunk): boolean {
  return chunk.kind === 'function' || chunk.kind === 'orphan';
}

/** The text two names share on a case-insensitive file system. */
function folded(name: string): string {
  return foldPath(name);
}

/**
 * The file of every chunk, aligned with `model.chunks`: `asm/nonmatchings/<module>/<Name>.s` for a function
 * or orphan chunk (`<Name>_<ADDR>.s` for each member of a case-folded collision group in its directory),
 * undefined for header, startup and data chunks, which their module's file holds.
 */
export function chunkPaths(model: Pick<Model, 'chunks'>): readonly (string | undefined)[] {
  const groupSize = new Map<string, number>();
  const keyOf = (chunk: Chunk): string => `${chunk.module}/${folded(chunk.name)}`;
  for (const chunk of model.chunks) {
    if (isFileChunk(chunk)) groupSize.set(keyOf(chunk), (groupSize.get(keyOf(chunk)) ?? 0) + 1);
  }
  return model.chunks.map((chunk) => {
    if (!isFileChunk(chunk)) return undefined;
    const name = (groupSize.get(keyOf(chunk)) ?? 0) > 1 ? `${chunk.name}_${hex(chunk.span.start)}` : chunk.name;
    return chunkFileOf(nonmatchingDir(chunk.module), name);
  });
}

const CHUNK_PATHS = new WeakMap<readonly Chunk[], readonly (string | undefined)[]>();

/**
 * chunkPaths(model), computed once per model and shared by the writers and the text-layout check: memoized by the
 * identity of the model's chunks array, which a Model never changes (deeply readonly, D19). The one other such
 * memo is resolver.ts's label index; D66 says why these two are memos rather than fields of the Model.
 */
export function chunkPathsOf(model: Pick<Model, 'chunks'>): readonly (string | undefined)[] {
  const cached = CHUNK_PATHS.get(model.chunks);
  if (cached !== undefined) return cached;
  const paths = chunkPaths(model);
  CHUNK_PATHS.set(model.chunks, paths);
  return paths;
}

/** The chunks of a module. */
function chunksOf(model: Pick<Model, 'chunks'>, module: Module): readonly Chunk[] {
  return model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count);
}

/**
 * The source a module builds from: asm/rom_header.s for the module holding the header chunk, asm/crt0.s for
 * the one holding the startup chunk, `asm/<module>.s` for another asm module (its includes in ROM order),
 * `data/<module>.s` for a data module, `src/<module>.c` for a C module (phase 4).
 */
export function moduleSource(model: Pick<Model, 'chunks'>, module: Module): string {
  const kinds = chunksOf(model, module).map((c) => c.kind);
  if (kinds.includes('header')) return HEADER_PATH;
  if (kinds.includes('startup')) return CRT0_PATH;
  switch (module.kind) {
    case 'asm':
      return `asm/${module.name}.s`;
    case 'data':
      return `data/${module.name}.s`;
    case 'c':
      return `src/${module.name}.c`;
  }
}

/** One link unit: a module, the source it builds from (`src/<m>.c` for a C module), and its object. */
export interface BuildUnit {
  readonly module: string;
  readonly source: string;
  readonly object: string;
}

/** The link unit of module `m`: a C source builds to build/src/<m>.o, an assembly one to build/<m>.o. */
function buildUnitOf(model: Pick<Model, 'chunks'>, m: Module): BuildUnit {
  const source = moduleSource(model, m);
  return { module: m.name, source, object: isCSource(source) ? cObjectPath(m.name) : objectPath(m.name) };
}

/** One unit per module, in ROM (link) order. */
export function buildUnits(model: Pick<Model, 'modules' | 'chunks'>): readonly BuildUnit[] {
  return model.modules.map((m) => buildUnitOf(model, m));
}

/** A build unit with the ROM range its object must reproduce (`verify --assemble`). */
export interface AssembleUnit extends BuildUnit {
  readonly span: Span;
}

/** One assemble unit per module, in ROM (link) order: buildUnits with each module's own span. */
export function assembleUnits(model: Pick<Model, 'modules' | 'chunks'>): readonly AssembleUnit[] {
  return model.modules.map((m) => ({ ...buildUnitOf(model, m), span: m.span }));
}

/**
 * The path prefixes a module's generated files lie under: its source file and, when it has function or
 * orphan chunks, its nonmatchings directory (with a trailing '/'). WritePlanInputs.retained is these, for
 * every module whose `generated` is false.
 */
export function modulePathPrefixes(model: Pick<Model, 'chunks'>, module: Module): readonly string[] {
  const source = moduleSource(model, module);
  return chunksOf(model, module).some(isFileChunk) ? [source, `${nonmatchingDir(module.name)}/`] : [source];
}

/** The path prefixes of the modules romlift does not generate (`generated = false`): planWrites never touches them (D62 d). */
export function retainedPrefixes(model: Pick<Model, 'modules' | 'chunks'>): readonly string[] {
  return model.modules.filter((m) => !m.generated).flatMap((m) => [...modulePathPrefixes(model, m)]);
}
