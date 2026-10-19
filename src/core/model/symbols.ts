// The model's symbols (architecture §6.2, §6.5): the config's [symbols], in address order. A symbol inside the
// ROM names data there (a data label, and the start of a data chunk in a data module); every other one (RAM,
// I/O, an absolute address) is for the symbols writer's symbols.ld.
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { Model, ModelSymbol } from './types.ts';

/** Every symbol of the config, sorted by address (one per address: the config keys them by address). */
export function modelSymbols(config: Pick<RomliftConfig, 'symbols'>): readonly ModelSymbol[] {
  return sortedEntries(config.symbols).map(([addr, s]) => (s.size === undefined ? { addr, name: s.name } : { addr, name: s.name, size: s.size }));
}

/** Whether `addr` lies outside the ROM [ROM_BASE, end): a RAM, I/O or absolute address, which symbols.ld defines. */
export function isOutsideRom(addr: Addr, rom: { readonly end: Addr }): boolean {
  return addr < ROM_BASE || addr >= rom.end;
}

/** The symbols that lie inside the ROM, in address order. */
export function romSymbols(symbols: readonly ModelSymbol[], rom: { readonly end: Addr }): readonly ModelSymbol[] {
  return symbols.filter((s) => !isOutsideRom(s.addr, rom));
}

/**
 * The symbols symbols.ld defines: those outside the ROM (isOutsideRom), by address then name. The symbols writer
 * prints them, the ldscript writer includes symbols.ld when there is one, and the text-layout check resolves
 * names through them.
 */
export function externalSymbols(model: Pick<Model, 'symbols' | 'rom'>): readonly ModelSymbol[] {
  return model.symbols.filter((s) => isOutsideRom(s.addr, model.rom)).sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
}
