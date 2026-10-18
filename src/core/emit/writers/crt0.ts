// The `crt0` writer (architecture §6.3): asm/crt0.s, the startup region in one file. Scope: module. Created
// empty by the phase lead; its body is p3-printer's (D62), and until then it yields nothing.
import type { Writer } from '../tree.ts';

export const crt0Writer: Writer = {
  id: 'crt0',
  scope: 'module',
  emit: () => [],
};
