// The `function` writer (architecture §6.3): asm/nonmatchings/<module>/<Name>.s, one file per function chunk,
// at the path core/model/paths.ts chunkPaths gives it (the case-fold rule included). Scope: module. The text
// is the chunk as printChunk prints it, without a preamble: the module's file includes it after its own, and
// GNU as refuses macros.inc twice; the chunk opens with `.thumb`/`.arm`, so it needs no earlier state.
import type { Writer } from '../tree.ts';
import { chunkFiles } from '../unit-text.ts';

export const functionWriter: Writer = {
  id: 'function',
  scope: 'module',
  emit: (rom, model, cx, module) => chunkFiles(rom, model, cx, module, 'function', 'function'),
};
