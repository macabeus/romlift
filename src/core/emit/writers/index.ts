// The writers (architecture §6.1 rungs 1 and 2, §6.3, D62, D74): the registry emitTree runs. Module-scoped
// writers run once per generated module, global ones once; tree.ts freezes the stream order. Phase 3's eight, then
// phase 4's modules-mk and c-stub; phase 6's expected and objdiff (D92).
import type { Writer } from '../tree.ts';
import { cStubWriter } from './c-stub.ts';
import { crt0Writer } from './crt0.ts';
import { dataWriter } from './data.ts';
import { expectedWriter } from './expected.ts';
import { functionWriter } from './function.ts';
import { headerWriter } from './header.ts';
import { ldscriptWriter } from './ldscript.ts';
import { moduleWriter } from './module.ts';
import { modulesMkWriter } from './modules-mk.ts';
import { objdiffWriter } from './objdiff.ts';
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
  modulesMkWriter,
  cStubWriter,
  expectedWriter,
  objdiffWriter,
];
