// A resolver for isa tests: every address is named `_XXXXXXXX`, and that name maps back.
import type { SymbolResolver } from '../../../src/foundation/isa/types.ts';
import { hex } from '../../../src/foundation/util/hex.ts';

export const LABELS: SymbolResolver = {
  labelFor: (addr) => `_${hex(addr)}`,
  addressOf: (name) => (/^_[0-9A-F]{8}$/.test(name) ? Number.parseInt(name.slice(1), 16) : undefined),
};

/** A resolver that knows no address. */
export const NO_LABELS: SymbolResolver = { labelFor: () => undefined, addressOf: () => undefined };
