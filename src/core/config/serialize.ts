// The canonical romlift.toml (architecture §6.5, D22, D23): the layout `init` writes and the patch planner edits.
//
//   schema = 1, then [rom], [build], [signatures], one [[modules]] block per module in link order, [functions]
//   and [symbols] with one line per entry in address order, and one [[overrides]] block per override in the
//   config's order; one blank line between blocks, a final newline, no comment.
//
// A [functions] entry is `0x08000470 = "Name"` when it is a Thumb entry with nothing else, else an inline table
// with the keys in the fixed order name, mode (only `arm`), size, label (only `true`), aliases (only when there
// are some), from; a [symbols] entry likewise (name, size, type, aliases, from). A module writes name, start, kind,
// then `data_start` only when set (phase 6, D92), `generated = false` only when false, and compiler, cflags, library
// and version only when set. Address keys and address values
// are `0x` and eight upper-case hex digits; sizes are upper-case hex without padding. parse.ts reads exactly this
// back: serializeConfig(parseConfig(text).value) === text for every canonical text. Pure.
import type { Addr } from '../../foundation/rom/span.ts';
import { hex, hexAddr } from '../../foundation/util/hex.ts';
import { sortedEntries } from '../../foundation/util/sorted.ts';
import { addressKey } from './keys.ts';
import type { FunctionConfig, ModuleConfig, OverrideConfig, RomliftConfig, SymbolConfig } from './schema.ts';

/** A TOML basic string: `"`, `\` and control characters escaped, everything else as it is. */
export function tomlString(text: string): string {
  let out = '"';
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else if (c === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\u${hex(code, 4)}`;
    else out += c;
  }
  return `${out}"`;
}

function stringArray(items: readonly string[]): string {
  return `[${items.map(tomlString).join(', ')}]`;
}

/** A size: `0x` and upper-case hex digits, unpadded (`0x3A4`). */
export function tomlSize(size: number): string {
  return `0x${(size >>> 0).toString(16).toUpperCase()}`;
}

/** An address value: `0x` and eight upper-case hex digits. */
export function tomlAddress(addr: Addr): string {
  return hexAddr(addr);
}

function inlineTable(pairs: readonly (readonly [string, string])[]): string {
  return `{ ${pairs.map(([k, v]) => `${k} = ${v}`).join(', ')} }`;
}

/** The value of a [functions] entry: a bare name for a Thumb entry with nothing else, else an inline table. */
export function functionValue(fn: FunctionConfig): string {
  const pairs: (readonly [string, string])[] = [['name', tomlString(fn.name)]];
  if (fn.mode === 'arm') pairs.push(['mode', tomlString(fn.mode)]);
  if (fn.size !== undefined) pairs.push(['size', tomlSize(fn.size)]);
  if (fn.label === true) pairs.push(['label', 'true']);
  if (fn.aliases.length > 0) pairs.push(['aliases', stringArray(fn.aliases)]);
  if (fn.from !== undefined) pairs.push(['from', tomlString(fn.from)]);
  return pairs.length === 1 ? tomlString(fn.name) : inlineTable(pairs);
}

/** The value of a [symbols] entry. */
export function symbolValue(symbol: SymbolConfig): string {
  const pairs: (readonly [string, string])[] = [['name', tomlString(symbol.name)]];
  if (symbol.size !== undefined) pairs.push(['size', tomlSize(symbol.size)]);
  if (symbol.type !== undefined) pairs.push(['type', tomlString(symbol.type)]);
  if (symbol.aliases.length > 0) pairs.push(['aliases', stringArray(symbol.aliases)]);
  if (symbol.from !== undefined) pairs.push(['from', tomlString(symbol.from)]);
  return pairs.length === 1 ? tomlString(symbol.name) : inlineTable(pairs);
}

/** One [functions] line. */
export function functionLine(addr: Addr, fn: FunctionConfig): string {
  return `${addressKey(addr)} = ${functionValue(fn)}`;
}

/** One [symbols] line. */
export function symbolLine(addr: Addr, symbol: SymbolConfig): string {
  return `${addressKey(addr)} = ${symbolValue(symbol)}`;
}

/** One [[modules]] block, without a trailing blank line. */
export function moduleLines(module: ModuleConfig): string[] {
  const lines = ['[[modules]]', `name = ${tomlString(module.name)}`, `start = ${tomlAddress(module.start)}`, `kind = ${tomlString(module.kind)}`];
  if (module.dataStart !== undefined) lines.push(`data_start = ${tomlAddress(module.dataStart)}`);
  if (!module.generated) lines.push('generated = false');
  if (module.compiler !== undefined) lines.push(`compiler = ${tomlString(module.compiler)}`);
  if (module.cflags !== undefined) lines.push(`cflags = ${stringArray(module.cflags)}`);
  if (module.library !== undefined) lines.push(`library = ${tomlString(module.library)}`);
  if (module.version !== undefined) lines.push(`version = ${tomlString(module.version)}`);
  return lines;
}

/** One [[overrides]] block, without a trailing blank line. */
export function overrideLines(override: OverrideConfig): string[] {
  const lines = ['[[overrides]]', `start = ${tomlAddress(override.start)}`, `size = ${tomlSize(override.size)}`, `kind = ${tomlString(override.kind)}`];
  if (override.mode !== undefined) lines.push(`mode = ${tomlString(override.mode)}`);
  if (override.runsAt !== undefined) lines.push(`runs_at = ${tomlAddress(override.runsAt)}`);
  if (override.from !== undefined) lines.push(`from = ${tomlString(override.from)}`);
  return lines;
}

/** The canonical text of `config`, the layout `init` writes. */
export function serializeConfig(config: RomliftConfig): string {
  const blocks: string[][] = [
    ['schema = 1'],
    ['[rom]', `path = ${tomlString(config.rom.path)}`, `sha1 = ${tomlString(config.rom.sha1)}`],
    ['[build]', `name = ${tomlString(config.build.name)}`, `compiler = ${tomlString(config.build.compiler)}`],
    [
      '[signatures]',
      `enabled = ${config.signatures.enabled ? 'true' : 'false'}`,
      ...(config.signatures.libraries === undefined ? [] : [`libraries = ${stringArray(config.signatures.libraries)}`]),
    ],
    ...config.modules.map(moduleLines),
    ['[functions]', ...sortedEntries(config.functions).map(([addr, fn]) => functionLine(addr, fn))],
    ['[symbols]', ...sortedEntries(config.symbols).map(([addr, symbol]) => symbolLine(addr, symbol))],
    ...config.overrides.map(overrideLines),
  ];
  return `${blocks.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}
