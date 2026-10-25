// Module inference options (architecture §6.2, D20, D62). inferModules (core/layout/infer-modules.ts) and
// configFromDiscover (core/workflow/config-from-discover.ts, which may import core/config) take them.
import type { Addr, Span } from '../../foundation/rom/span.ts';
import type { LibraryRegion } from '../proposals/types.ts';

/**
 * The default `--module-size`: a C module closes at the first legal border past this many bytes. Measured on
 * the tuning maps: 90% of C translation units have at most 0xFF70 bytes of `.text` (D20).
 */
export const DEFAULT_MODULE_SIZE = 0x10000;

export interface InferModulesOptions {
  /** Default DEFAULT_MODULE_SIZE. */
  readonly moduleSize?: number;
  /**
   * The library regions the signatures placed (phase 6): each becomes `asm` modules carrying its library and version,
   * shrunk to the legal borders inside it and cut around every runs_at range (placeLibraries); empty: none.
   */
  readonly libraries?: readonly LibraryRegion[];
  /** The hand-written runs_at ranges (§6.7): each its own `asm` module `ram_<RUNADDR>`, exactly as given. */
  readonly runsAt?: readonly RunsAtRange[];
}

/** A hand-written [[overrides]] range with runs_at (architecture §6.7): its load span and its run address. */
export interface RunsAtRange {
  readonly span: Span;
  readonly runAt: Addr;
}

/** configFromDiscover's options: the inference options, nothing else. */
export type ConfigFromDiscoverOptions = InferModulesOptions;
