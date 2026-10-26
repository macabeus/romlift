// The `function` writer (architecture §6.3): asm/nonmatchings/<module>/<Name>.s, one file per function chunk,
// at the path core/model/paths.ts chunkPaths gives it (the case-fold rule included); since phase 6 (D92) a function of
// a `c` module that src/<module>.c (or a fragment it includes) defines outside every conditional, as compiledDefinitions
// reads it (EmitContext.decomp), goes to asm/matchings/<module>/<Name>.s instead (unit-text.ts writtenChunkPath): its C
// replaced the stub, so no INCLUDE_ASM names that file, and it moves back on the generate after its C is gone (the
// manifest deletes the old spelling). Scope: module. The text is the chunk as printChunk prints it, without a preamble:
// the module's file includes it after its own, and GNU as refuses macros.inc twice; the chunk opens with
// `.thumb`/`.arm`, so it needs no earlier state. A chunk that folded the zero pad before its entry
// (core/model/chunks.ts) starts at the pad, which its start macro emits.
import type { Writer } from '../tree.ts';
import { chunkFiles } from '../unit-text.ts';

export const functionWriter: Writer = {
  id: 'function',
  scope: 'module',
  emit: (rom, model, cx, module) => chunkFiles(rom, model, cx, module, 'function', 'function'),
};
