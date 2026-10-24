// What the chunk-file and unit-file writers share (architecture §6.3): a file's text
// from its lines, the entries of one module's chunk files, a module's source text and the module a source
// path belongs to. Writer-neutral, so each file of writers/ keeps only its Writer: the function and orphan
// writers emit chunkFiles, the module, header and crt0 writers unitText.
//
// Where a chunk file is written is decided here, once (writtenChunkPath; phase 6, D92): at the path core/model/paths.ts
// gives its chunk (`asm/nonmatchings/<module>/<Name>.s`), except a function of a `c` module that the project's C defines
// for the default build (EmitContext.decomp, the workflow's compiledDefinitions), which goes to
// `asm/matchings/<module>/<Name>.s` (foundation/util/project-files.ts matchingFileOf): no INCLUDE_ASM names it, since
// its C replaced the stub. An orphan, and a function of an asm module (whose source `.include`s every chunk file), stays.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { pushAll } from '../../foundation/util/arrays.ts';
import { matchingFileOf } from '../../foundation/util/project-files.ts';
import { chunkPathsOf, moduleSource } from '../model/paths.ts';
import type { ChunkKind, Model, Module } from '../model/types.ts';
import { printChunk } from './print/chunk.ts';
import type { EmitContext, FileEntry, WriterId } from './tree.ts';

/** Lines as a file's text: newline-separated, ending with a newline. */
function fileText(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** The names the project's C defines (EmitContext.decomp), as a set, once per DecompState. */
const DEFINED = new WeakMap<readonly string[], ReadonlySet<string>>();

function definedOf(cx: EmitContext): ReadonlySet<string> {
  const cached = DEFINED.get(cx.decomp.defined);
  if (cached !== undefined) return cached;
  const set = new Set(cx.decomp.defined);
  DEFINED.set(cx.decomp.defined, set);
  return set;
}

/**
 * Where chunk `chunk` of module `module` is written, or undefined when it has no file of its own: the model's chunk path
 * (chunkPathsOf), or its asm/matchings twin for a function of a `c` module that `cx.decomp` says the C defines.
 */
export function writtenChunkPath(model: Model, cx: EmitContext, module: Module, chunk: number): string | undefined {
  const path = chunkPathsOf(model)[chunk];
  const c = model.chunks[chunk];
  if (path === undefined || c === undefined || c.kind !== 'function' || module.kind !== 'c') return path;
  return definedOf(cx).has(c.name) ? matchingFileOf(path) : path;
}

/** One generated entry per chunk of `kind` in module `module` that has a file, at its written path. */
export function* chunkFiles(rom: Rom, model: Model, cx: EmitContext, module: number | null, kind: ChunkKind, writer: WriterId): Iterable<FileEntry> {
  const m = module === null ? undefined : model.modules[module];
  if (m === undefined) return;
  for (let i = m.chunks.first; i < m.chunks.first + m.chunks.count; i++) {
    const path = writtenChunkPath(model, cx, m, i);
    if (path === undefined || model.chunks[i]?.kind !== kind) continue;
    yield { ownership: 'generated', path, text: fileText(printChunk(rom, model, i, cx).lines), writer };
  }
}

/** How a unit file lays out its chunks. */
export interface UnitLayout {
  /** Comment lines after the preamble. */
  readonly preface: readonly string[];
  /** Whether an inlined chunk is preceded by a blank line. */
  readonly spaced: boolean;
}

/** The text of a module's source file: the preamble, the preface, then each chunk included or inlined. */
export function unitText(rom: Rom, model: Model, cx: EmitContext, module: Module, layout: UnitLayout): string {
  const first = model.chunks[module.chunks.first];
  const lines: string[] = [...layout.preface];
  for (let i = module.chunks.first; i < module.chunks.first + module.chunks.count; i++) {
    const path = writtenChunkPath(model, cx, module, i);
    if (path !== undefined) {
      lines.push(`.include "${path}"`);
      continue;
    }
    if (layout.spaced) lines.push('');
    pushAll(lines, printChunk(rom, model, i, cx).lines);
  }
  return DIALECT.preamble(first?.mode ?? 'thumb') + fileText(lines);
}

/** The module at `module`, when its source is `path`. */
export function moduleWithSource(model: Model, module: number | null, path: (m: Module) => string): Module | undefined {
  const m = module === null ? undefined : model.modules[module];
  return m !== undefined && moduleSource(model, m) === path(m) ? m : undefined;
}
