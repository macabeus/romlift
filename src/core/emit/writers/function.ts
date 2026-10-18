// The `function` writer (architecture §6.3): asm/nonmatchings/<module>/<Name>.s, one file per function
// chunk. Scope: module. Created empty by the phase lead; its body is p3-printer's (D62), and until then it
// yields nothing.
import type { Writer } from '../tree.ts';

export const functionWriter: Writer = {
  id: 'function',
  scope: 'module',
  emit: () => [],
};
