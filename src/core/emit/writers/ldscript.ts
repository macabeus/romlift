// The `ldscript` writer (architecture §6.3): ldscript.txt. Scope: global. Created empty by the phase lead;
// its body is p3-data-verify's (D62), and until then it yields nothing.
import type { Writer } from '../tree.ts';

export const ldscriptWriter: Writer = {
  id: 'ldscript',
  scope: 'global',
  emit: () => [],
};
