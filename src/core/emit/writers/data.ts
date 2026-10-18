// The `data` writer (architecture §6.3): data/<module>.s: labels, .incbin slices and pointer tables. Scope:
// module. Created empty by the phase lead; its body is p3-data-verify's (D62), and until then it yields
// nothing.
import type { Writer } from '../tree.ts';

export const dataWriter: Writer = {
  id: 'data',
  scope: 'module',
  emit: () => [],
};
