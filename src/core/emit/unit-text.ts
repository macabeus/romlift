// What the chunk-file and unit-file writers share (architecture §6.3): the file of every chunk, a file's text
// from its lines, the entries of one module's chunk files, a module's source text and the module a source
// path belongs to. Writer-neutral, so each file of writers/ keeps only its Writer: the function and orphan
// writers emit chunkFiles, the module, header and crt0 writers unitText.
import { DIALECT } from '../../foundation/asm/dialect.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { pushAll } from '../../foundation/util/arrays.ts';
import { chunkPaths, moduleSource } from '../model/paths.ts';
import type { Chunk, ChunkKind, Model, Module } from '../model/types.ts';
import { printChunk } from './print/chunk.ts';
import type { EmitContext, FileEntry, WriterId } from './tree.ts';

const PATHS = new WeakMap<readonly Chunk[], readonly (string | undefined)[]>();

/** chunkPaths(model), computed once per model (cached by its chunks array, which a Model never changes). */
export function chunkFilePaths(model: Pick<Model, 'chunks'>): readonly (string | undefined)[] {
  const cached = PATHS.get(model.chunks);
  if (cached !== undefined) return cached;
  const paths = chunkPaths(model);
  PATHS.set(model.chunks, paths);
  return paths;
}

/** Lines as a file's text: newline-separated, ending with a newline. */
function fileText(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

/** One generated entry per chunk of `kind` in module `module` that has a file. */
export function* chunkFiles(rom: Rom, model: Model, cx: EmitContext, module: number | null, kind: ChunkKind, writer: WriterId): Iterable<FileEntry> {
  const m = module === null ? undefined : model.modules[module];
  if (m === undefined) return;
  const paths = chunkFilePaths(model);
  for (let i = m.chunks.first; i < m.chunks.first + m.chunks.count; i++) {
    const path = paths[i];
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
  const paths = chunkFilePaths(model);
  const first = model.chunks[module.chunks.first];
  const lines: string[] = [...layout.preface];
  for (let i = module.chunks.first; i < module.chunks.first + module.chunks.count; i++) {
    const path = paths[i];
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
