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
import { foldPath } from '../../foundation/util/fold.ts';
import { hex } from '../../foundation/util/hex.ts';
import type { Chunk, Model, Module } from './types.ts';

export const HEADER_PATH = 'asm/rom_header.s';
export const CRT0_PATH = 'asm/crt0.s';
export const LDSCRIPT_PATH = 'ldscript.txt';
export const SYMBOLS_PATH = 'symbols.ld';
/** The user's ROM at the project root: the config's rom.path, and the only file an `.incbin` reads. */
export const BASEROM_PATH = 'baserom.gba';
/** The macro file every generated `.s` includes, as the dialect defines it (foundation/asm/dialect.ts DIALECT.macrosPath). */
export const MACROS_PATH = DIALECT.macrosPath;

/** The directory of a module's function and orphan files, without a trailing '/'. */
export function nonmatchingDir(module: string): string {
  return `asm/nonmatchings/${module}`;
}

/** The object a module builds to. */
export function objectPath(module: string): string {
  return `build/${module}.o`;
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
    return `${nonmatchingDir(chunk.module)}/${name}.s`;
  });
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

/** One link unit: a module, the source it builds from, and its object. */
export interface BuildUnit {
  readonly module: string;
  readonly source: string;
  readonly object: string;
}

/** One unit per module, in ROM (link) order. */
export function buildUnits(model: Pick<Model, 'modules' | 'chunks'>): readonly BuildUnit[] {
  return model.modules.map((m) => ({ module: m.name, source: moduleSource(model, m), object: objectPath(m.name) }));
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
