// The `function` writer (architecture §6.3): asm/nonmatchings/<module>/<Name>.s, one file per function chunk,
// at the path core/model/paths.ts chunkPaths gives it (the case-fold rule included). Scope: module. The text
// is the chunk as printChunk prints it, without a preamble: the module's file includes it after its own, and
// GNU as refuses macros.inc twice; the chunk opens with `.thumb`/`.arm`, so it needs no earlier state.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { chunkPaths } from '../../model/paths.ts';
import type { Chunk, ChunkKind, Model } from '../../model/types.ts';
import { printChunk } from '../print/chunk.ts';
import type { EmitContext, FileEntry, Writer, WriterId } from '../tree.ts';

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
export function fileText(lines: readonly string[]): string {
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

export const functionWriter: Writer = {
  id: 'function',
  scope: 'module',
  emit: (rom, model, cx, module) => chunkFiles(rom, model, cx, module, 'function', 'function'),
};
