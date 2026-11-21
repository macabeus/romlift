// The TOML half of `romlift rename <old> <new>` (architecture §2.1, §6.5, §6.6, D9, D92): exactly one line of
// romlift.toml changes, the [functions] or [symbols] entry whose name, or one of whose aliases, is `from` gets `to`
// there, and a `from = …` key on that entry is dropped, since the name is now the user's choice (D9: a source that
// proposed the old name no longer explains the new one). The line keeps its indentation and its trailing comment; every
// other byte of the file is kept. The line is written from the config, which must be what the text says, and the patched
// text is parsed again and must mean the intended config (verifyPatched, the patch planner's check, both times).
//
// What one line cannot hold is refused with E_TOML_PATCH_REFUSED and the canonical line to paste, never guessed: an
// entry restructured by hand (a `[functions.0x…]` table, dotted keys, a value over several lines), and a name that
// more than one entry carries. A name no entry carries is refused too; `planRename` (core/workflow/rename.ts) reports
// it as E_RENAME_UNKNOWN before asking. Pure; never throws.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { sortedEntries } from '../../foundation/util/sorted.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';
import { addressDefinitions, addressKey, addressKeyUses, outlineToml } from './keys.ts';
import type { AddressTable } from './keys.ts';
import { verifyPatched } from './patch.ts';
import type { EntryPointConfig, FunctionConfig, RomliftConfig, SymbolConfig } from './schema.ts';
import { entryPointLine, functionLine, symbolLine } from './serialize.ts';

/** The entry a rename patches: its table and address, and whether `from` is its name or one of its aliases. */
export interface RenamedEntry {
  readonly table: AddressTable;
  readonly addr: Addr;
  readonly role: 'name' | 'alias';
}

export type RenamePatchResult =
  | { readonly ok: true; readonly text: string; readonly entry: RenamedEntry; readonly config: RomliftConfig }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ConfigCode>[] };

/** Every [functions], [entry_points] and [symbols] entry whose name or one of whose aliases is `name`, in that order, by address. */
export function entriesNamed(
  config: Pick<RomliftConfig, 'functions' | 'entryPoints' | 'symbols'>,
  name: string,
): readonly RenamedEntry[] {
  const out: RenamedEntry[] = [];
  const scan = (
    table: AddressTable,
    entries: ReadonlyMap<Addr, FunctionConfig | EntryPointConfig | SymbolConfig>,
  ): void => {
    for (const [addr, entry] of sortedEntries(entries)) {
      if (entry.name === name) out.push({ table, addr, role: 'name' });
      else if (entry.aliases.includes(name)) out.push({ table, addr, role: 'alias' });
    }
  };
  scan('functions', config.functions);
  scan('entry_points', config.entryPoints);
  scan('symbols', config.symbols);
  return out;
}

/** `name` as `from` spelled `to`, else as it is. */
function respelled(name: string, from: string, to: string): string {
  return name === from ? to : name;
}

/**
 * `fn` with `from` (its name or an alias) spelled `to`, and no `from` key; every other key kept as it is, so a key
 * FunctionConfig gains later survives a rename (architecture-13).
 */
function renamedFunction(fn: FunctionConfig, from: string, to: string): FunctionConfig {
  const { from: _source, ...rest } = fn;
  return { ...rest, name: respelled(fn.name, from, to), aliases: fn.aliases.map((a) => respelled(a, from, to)) };
}

/** `e` with `from` (its name or an alias) spelled `to`, and no `from` key; every other key kept as it is. */
function renamedEntryPoint(e: EntryPointConfig, from: string, to: string): EntryPointConfig {
  const { from: _source, ...rest } = e;
  return { ...rest, name: respelled(e.name, from, to), aliases: e.aliases.map((a) => respelled(a, from, to)) };
}

/** `symbol` with `from` (its name or an alias) spelled `to`, and no `from` key; every other key kept as it is. */
function renamedSymbol(symbol: SymbolConfig, from: string, to: string): SymbolConfig {
  const { from: _source, ...rest } = symbol;
  return {
    ...rest,
    name: respelled(symbol.name, from, to),
    aliases: symbol.aliases.map((a) => respelled(a, from, to)),
  };
}

function refused(message: string, addr?: Addr): Diagnostic<ConfigCode> {
  return diagnostic(ConfigCodes, 'E_TOML_PATCH_REFUSED', message, addr === undefined ? {} : { addr });
}

/** `config` with its entry at `entry` renamed, and that entry's canonical line. */
function intendedOf(
  config: RomliftConfig,
  entry: RenamedEntry,
  from: string,
  to: string,
): { readonly config: RomliftConfig; readonly line: string } | undefined {
  if (entry.table === 'functions') {
    const was = config.functions.get(entry.addr);
    if (was === undefined) return undefined;
    const now = renamedFunction(was, from, to);
    return {
      config: { ...config, functions: new Map([...config.functions, [entry.addr, now]]) },
      line: functionLine(entry.addr, now),
    };
  }
  if (entry.table === 'entry_points') {
    const was = config.entryPoints.get(entry.addr);
    if (was === undefined) return undefined;
    const now = renamedEntryPoint(was, from, to);
    return {
      config: { ...config, entryPoints: new Map([...config.entryPoints, [entry.addr, now]]) },
      line: entryPointLine(entry.addr, now),
    };
  }
  const was = config.symbols.get(entry.addr);
  if (was === undefined) return undefined;
  const now = renamedSymbol(was, from, to);
  return {
    config: { ...config, symbols: new Map([...config.symbols, [entry.addr, now]]) },
    line: symbolLine(entry.addr, now),
  };
}

/**
 * The one-line patch of `text` (the romlift.toml `config` was parsed from) that renames `from` to `to`: the entry that
 * carries `from` as its name or as an alias is rewritten on its line, without its `from` key. Refused
 * (E_TOML_PATCH_REFUSED) when no entry or more than one carries `from`, when the entry is not one single-line
 * `0x… = value` statement directly under its table, or when the patched text does not parse to the intended config.
 */
export function planRenamePatch(text: string, config: RomliftConfig, from: string, to: string): RenamePatchResult {
  const named = entriesNamed(config, from);
  const entry = named[0];
  if (entry === undefined)
    return {
      ok: false,
      diagnostics: [
        refused(
          `no [functions], [entry_points] or [symbols] entry of romlift.toml is named ${from} or has it as an alias`,
        ),
      ],
    };
  if (named.length > 1) {
    const where = named.map((e) => `[${e.table}] ${addressKey(e.addr)}`).join(', ');
    return {
      ok: false,
      diagnostics: [
        refused(
          `${from} names more than one entry of romlift.toml (${where}); give each its own name first`,
          entry.addr,
        ),
      ],
    };
  }
  const intended = intendedOf(config, entry, from, to);
  if (intended === undefined)
    return {
      ok: false,
      diagnostics: [refused(`the config has no [${entry.table}] entry at ${addressKey(entry.addr)}`, entry.addr)],
    };
  const uses = addressKeyUses(outlineToml(text));
  const places = addressDefinitions(uses).filter((d) => d.table === entry.table && d.addr === entry.addr);
  const statement = places.length === 1 ? places[0]?.use.statement : undefined;
  const own =
    statement !== undefined &&
    places[0]?.use.shape === 'line' &&
    statement.endLine === statement.line &&
    statement.table.length === 1 &&
    statement.table[0] === entry.table &&
    statement.key.length === 1;
  if (!own) {
    const lines = places.map((p) => p.line).join(', ');
    return {
      ok: false,
      diagnostics: [
        refused(
          `${addressKey(entry.addr)} in [${entry.table}] is not one single-line entry (line ${lines || '?'}): it was restructured by hand, so rename does not edit it; replace it with this line under [${entry.table}]: ${intended.line}`,
          entry.addr,
        ),
      ],
    };
  }
  // The line is written from `config`, so `config` must be what `text` says, or the line would carry what it does not.
  const read = verifyPatched(text, config, config);
  if (read !== undefined)
    return {
      ok: false,
      diagnostics: [refused(`the config rename was given is not what romlift.toml says (${read.message})`, entry.addr)],
    };
  const patched = `${text.slice(0, statement.start)}${intended.line}${text.slice(statement.valueEnd)}`;
  const mismatch = verifyPatched(patched, config, intended.config);
  if (mismatch !== undefined) return { ok: false, diagnostics: [mismatch] };
  return { ok: true, text: patched, entry, config: intended.config };
}
