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
import { chunkFileOf, cSourceOf, isCSource, nonmatchingDir, NONMATCHINGS_ROOT, stubNameOf } from '../../foundation/util/project-files.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { hex } from '../../foundation/util/hex.ts';
import { sortedKeys } from '../../foundation/util/sorted.ts';
import type { Span } from '../../foundation/rom/span.ts';
import type { BuildCompilerId } from '../config/compilers.ts';
import { cDataRangeOf } from './c-data-assert.ts';
import type { CDataRange } from './c-data-assert.ts';
import type { Chunk, Model, Module } from './types.ts';

export const HEADER_PATH = 'asm/rom_header.s';
export const CRT0_PATH = 'asm/crt0.s';
export const LDSCRIPT_PATH = 'ldscript.txt';
export const SYMBOLS_PATH = 'symbols.ld';
/** The per-unit build variables the scaffold's Makefile includes (the modules-mk writer, D74 f). */
export const MODULES_MK_PATH = 'modules.mk';
/** objdiff-cli's project file, the objdiff writer's (phase 6, D92). */
export const OBJDIFF_JSON_PATH = 'objdiff.json';
/** The macro file every generated `.s` includes, as the dialect defines it (foundation/asm/dialect.ts DIALECT.macrosPath). */
export const MACROS_PATH = DIALECT.macrosPath;

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

/** The objdiff target of module `module` (phase 6, D92): the expected writer's source, the whole module at its exact offsets. */
export function expectedSourcePath(module: string): string {
  return `expected/${module}.s`;
}

/**
 * Whether module `module` has an objdiff target (the expected writer's file, modules.mk's EXPECTED_OBJS, a unit of
 * objdiff.json): it is generated (emitTree writes its files) and holds chunks.
 */
export function hasExpectedTarget(module: Module | undefined): module is Module {
  return module !== undefined && module.generated && module.chunks.count > 0;
}

/** The object `make expected` assembles expectedSourcePath(module) into, objdiff's target object. */
export function expectedObjectPath(module: string): string {
  return `expected/${module}.o`;
}

/** The assembly agbcc writes for C module `module`, which `as` assembles to cObjectPath(module). */
export function cAssemblyPath(module: string): string {
  return `build/src/${module}.s`;
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

/** A case-folded group member's file base name: `<Name>_<ADDR>`, ADDR eight upper-case hex digits (chunkPaths). */
const GROUP_MEMBER = /^(.+)_[0-9A-F]{8}$/;

/**
 * The names of the function and orphan chunks a tree's chunk files hold, from their paths alone (chunkPaths'
 * inverse), unique, in code-unit order: each file's base name, and also `<Name>` for each member of a case-folded
 * group, a file `<Name>_<ADDR>.s` whose directory holds another such file of a different `<Name>` that folds to the
 * same text. A function named `sub_<ADDR>` is not mistaken for a group named `sub`, since every such file of a
 * directory has the same `<Name>`. Files outside the nonmatchings directories are ignored.
 */
export function chunkNamesOf(files: Iterable<string>): readonly string[] {
  const names = new Set<string>();
  /** Per directory and folded group name, the distinct `<Name>`s of its `<Name>_<ADDR>` files. */
  const groups = new Map<string, Set<string>>();
  for (const file of files) {
    const dir = file.slice(0, Math.max(0, file.lastIndexOf('/')));
    const base = stubNameOf(file);
    if (!dir.startsWith(`${NONMATCHINGS_ROOT}/`) || chunkFileOf(dir, base) !== file) continue;
    names.add(base);
    const member = GROUP_MEMBER.exec(base)?.[1];
    if (member === undefined) continue;
    const key = `${dir}/${folded(member)}`;
    const group = groups.get(key) ?? new Set<string>();
    group.add(member);
    groups.set(key, group);
  }
  for (const key of sortedKeys(groups)) {
    const group = groups.get(key) ?? new Set<string>();
    if (group.size > 1) for (const name of sortedKeys(group)) names.add(name);
  }
  return sortedKeys(names);
}

/**
 * The stub names of the chunk files of `files` (a tree's project paths) that lie directly in module `module`'s
 * nonmatchings directory, in the order given: each file's base name, a file whose path is chunkFileOf of its
 * directory and base name (the same round trip as chunkNamesOf). The one reader of "the chunk files of one module"
 * of a tree on disk (fix round 5, architecture-b0-7).
 */
export function moduleChunkStubs(files: Iterable<string>, module: string): readonly string[] {
  const dir = nonmatchingDir(module);
  const out: string[] = [];
  for (const file of files) {
    const base = stubNameOf(file);
    if (chunkFileOf(dir, base) === file) out.push(base);
  }
  return out;
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
      return cSourceOf(`${module.name}.c`);
  }
}

/** One link unit: a module, the source it builds from (`src/<m>.c` for a C module), and its object. */
export interface BuildUnit {
  readonly module: string;
  readonly source: string;
  readonly object: string;
  /**
   * The build compiler of a C unit (the module's `compiler`), whose assembly of the stub `verify --assemble/--link`
   * writes (core/model/c-unit.ts stubAssemblyText); absent for an assembly source.
   */
  readonly compiler?: BuildCompilerId;
  /**
   * A C unit's data range (Module.dataRange, phase 6) with the labels its object defines there: the ldscript places the
   * object's `.rodata` at it, and `verify --assemble/--link` stand in for that `.rodata` with the ROM's bytes
   * (core/model/c-data-assert.ts cDataStandIn). Absent for every other unit.
   */
  readonly data?: CDataRange;
}

/** The link unit of module `m`: a C source builds to build/src/<m>.o with the module's compiler, an assembly one to build/<m>.o. */
function buildUnitOf(model: Pick<Model, 'chunks' | 'labels'>, m: Module): BuildUnit {
  const source = moduleSource(model, m);
  if (!isCSource(source)) return { module: m.name, source, object: objectPath(m.name) };
  const unit = { module: m.name, source, object: cObjectPath(m.name), compiler: m.compiler };
  return m.dataRange === undefined ? unit : { ...unit, data: cDataRangeOf(m.dataRange, model.labels) };
}

/** One unit per module, in ROM (link) order. */
export function buildUnits(model: Pick<Model, 'modules' | 'chunks' | 'labels'>): readonly BuildUnit[] {
  return model.modules.map((m) => buildUnitOf(model, m));
}

/** A build unit with the ROM range its object's `.text` must reproduce (`verify --assemble`): its module's span; a data range's is BuildUnit.data. */
export interface AssembleUnit extends BuildUnit {
  readonly span: Span;
}

/** One assemble unit per module, in ROM (link) order: buildUnits with each module's own span. */
export function assembleUnits(model: Pick<Model, 'modules' | 'chunks' | 'labels'>): readonly AssembleUnit[] {
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
