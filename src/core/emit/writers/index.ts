// The phase-3 writers (architecture §6.1 rung 1, §6.3, D62): the registry emitTree runs. Module-scoped
// writers run once per generated module, global ones once; tree.ts freezes the stream order. Phase 4 adds
// modules-mk and c-stub, phase 5 expected and objdiff.
import type { Writer } from '../tree.ts';
import { crt0Writer } from './crt0.ts';
import { dataWriter } from './data.ts';
import { functionWriter } from './function.ts';
import { headerWriter } from './header.ts';
import { ldscriptWriter } from './ldscript.ts';
import { moduleWriter } from './module.ts';
import { orphanWriter } from './orphan.ts';
import { symbolsWriter } from './symbols.ts';

/** In the order of the writers table of §6.3; emitTree sorts each module's entries by path, not by writer. */
export const WRITERS: readonly Writer[] = [
  headerWriter,
  crt0Writer,
  functionWriter,
  orphanWriter,
  moduleWriter,
  dataWriter,
  ldscriptWriter,
  symbolsWriter,
];
