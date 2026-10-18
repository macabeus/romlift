// The `orphan` writer (architecture §6.3): asm/nonmatchings/<module>/unk_XXXXXXXX.s, one file per orphan
// chunk. Scope: module. Created empty by the phase lead; its body is p3-printer's (D62), and until then it
// yields nothing.
import type { Writer } from '../tree.ts';

export const orphanWriter: Writer = {
  id: 'orphan',
  scope: 'module',
  emit: () => [],
};
