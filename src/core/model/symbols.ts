// The model's symbols (architecture §6.2, §6.5): the config's [symbols], in address order. A symbol inside the
// ROM names data there (a data label, and the start of a data chunk in a data module); every other one (RAM,
// I/O, an absolute address) is for the symbols writer's symbols.ld.
import { isBiosIwram, isRamAddress } from '../../foundation/rom/memory-map.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { dataName } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, compareNumbers, sortedEntries, sortedKeys } from '../../foundation/util/sorted.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { sizedEntryAt } from './resolver.ts';
import type { SizedEntries } from './resolver.ts';
import type { Model, ModelSymbol, Module } from './types.ts';

/** Every symbol of the config, sorted by address (one per address: the config keys them by address). */
export function modelSymbols(config: Pick<RomliftConfig, 'symbols'>): readonly ModelSymbol[] {
  return sortedEntries(config.symbols).map(([addr, s]) =>
    s.size === undefined ? { addr, name: s.name } : { addr, name: s.name, size: s.size },
  );
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
  return model.symbols
    .filter((s) => isOutsideRom(s.addr, model.rom))
    .sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
}

/**
 * `symbols` with a default `gUnk_<ADDR>` entry (D111) at every work-RAM address one of `words` (the pool words) holds
 * that nothing names: no symbol is there, no sized entry holds it (that word prints `name + offset`, D102, D110), and no
 * runs_at range runs over it (code there has its own labels). The BIOS's top of IWRAM (isBiosIwram) gets none (D113):
 * C spells those words as constants, so a name there would put a relocation in expected/ that no C object has; a
 * [symbols] entry there is still honoured. The ROM's data gets its default labels from its data
 * modules (labels.ts); RAM has no module, so its default names are symbols, which symbols.ld defines. A default entry
 * is no knowledge: it bounds no inferred extent (extents.ts reads the config's symbols only).
 */
export function withDefaultRamSymbols(
  words: readonly number[],
  symbols: readonly ModelSymbol[],
  entries: SizedEntries,
  relocated: readonly Module[],
): readonly ModelSymbol[] {
  const named = new Set(symbols.map((s) => s.addr));
  const runs = relocated.flatMap((m) =>
    m.runAt === undefined ? [] : [{ start: m.runAt, end: m.runAt + (m.span.end - m.span.start) }],
  );
  const fresh = new Set<number>();
  for (const w of words) {
    if (!isRamAddress(w) || isBiosIwram(w) || named.has(w) || sizedEntryAt(entries, w) !== undefined) continue;
    if (runs.some((r) => w >= r.start && w < r.end)) continue;
    fresh.add(w);
  }
  if (fresh.size === 0) return symbols;
  const defaults = sortedKeys(fresh).map((addr): ModelSymbol => ({ addr, name: dataName(addr), default: true }));
  return [...symbols, ...defaults].sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
}
