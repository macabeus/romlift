// The `header` writer (architecture §6.3): asm/rom_header.s, the cartridge header. Scope: module. Created
// empty by the phase lead; its body is p3-printer's (D62), and until then it yields nothing.
import type { Writer } from '../tree.ts';

export const headerWriter: Writer = {
  id: 'header',
  scope: 'module',
  emit: () => [],
};
