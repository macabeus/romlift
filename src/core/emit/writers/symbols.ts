// The `symbols` writer (architecture §6.3): symbols.ld: RAM and absolute symbols. Scope: global. Created
// empty by the phase lead; its body is p3-data-verify's (D62), and until then it yields nothing.
import type { Writer } from '../tree.ts';

export const symbolsWriter: Writer = {
  id: 'symbols',
  scope: 'global',
  emit: () => [],
};
