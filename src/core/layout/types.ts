// Module inference options (architecture §6.2, D20, D62). inferModules (core/layout/infer-modules.ts) and
// configFromDiscover (core/workflow/config-from-discover.ts, which may import core/config) take them.
import type { LibraryRegion } from '../proposals/types.ts';

/**
 * The default `--module-size`: a C module closes at the first legal border past this many bytes. Measured on
 * the tuning maps: 90% of C translation units have at most 0xFF70 bytes of `.text` (D20).
 */
export const DEFAULT_MODULE_SIZE = 0x10000;

export interface InferModulesOptions {
  /** Default DEFAULT_MODULE_SIZE. */
  readonly moduleSize?: number;
  /** One asm module per region, cut on legal borders; empty before phase 6's signatures. */
  readonly libraries?: readonly LibraryRegion[];
}

/** configFromDiscover's options: the inference options, nothing else. */
export type ConfigFromDiscoverOptions = InferModulesOptions;
