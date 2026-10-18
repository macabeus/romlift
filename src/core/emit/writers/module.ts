// The `module` writer (architecture §6.3): asm/<module>.s of an asm module: its chunks' includes in ROM
// order. Scope: module. Created empty by the phase lead; its body is p3-printer's (D62), and until then it
// yields nothing.
import type { Writer } from '../tree.ts';

export const moduleWriter: Writer = {
  id: 'module',
  scope: 'module',
  emit: () => [],
};
