// The model's symbols (architecture §6.2, §6.5): the config's [symbols], in address order. A symbol inside the
// ROM names data there (a data label, and the start of a data chunk in a data module); every other one (RAM,
// I/O, an absolute address) is for the symbols writer's symbols.ld.
import type { Rom } from '../../foundation/rom/rom.ts';
import { contains } from '../../foundation/rom/rom.ts';
import { sortedEntries } from '../../foundation/util/sorted.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { ModelSymbol } from './types.ts';

/** Every symbol of the config, sorted by address (one per address: the config keys them by address). */
export function modelSymbols(config: Pick<RomliftConfig, 'symbols'>): readonly ModelSymbol[] {
  return sortedEntries(config.symbols).map(([addr, s]) => (s.size === undefined ? { addr, name: s.name } : { addr, name: s.name, size: s.size }));
}

/** The symbols that lie inside the ROM, in address order. */
export function romSymbols(symbols: readonly ModelSymbol[], rom: Rom): readonly ModelSymbol[] {
  return symbols.filter((s) => contains(rom, s.addr));
}
