// The `orphan` writer (architecture §6.2, §6.3): asm/nonmatchings/<module>/unk_XXXXXXXX.s, one file per orphan
// chunk (the bytes between two functions of a code module, never glued to a neighbour): the `@ bytes between
// functions` comment, a global `unk_` label and its bytes as data. The zero pad a function's start macro emits is
// no orphan: core/model/chunks.ts folds it into that function's chunk, so it has no file here. Scope: module.
import type { Writer } from '../tree.ts';
import { chunkFiles } from '../unit-text.ts';

export const orphanWriter: Writer = {
  id: 'orphan',
  scope: 'module',
  emit: (rom, model, cx, module) => chunkFiles(rom, model, cx, module, 'orphan', 'orphan'),
};
