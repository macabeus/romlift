// Where every key of a romlift.toml is, and the checks of its address keys (architecture §6.5, D22, D23).
//
// smol-toml returns values without positions, refuses a literally repeated key with a generic message and
// accepts `0x8000470` as a key, so the address checks read the text itself: `outlineToml` lists every table
// header and every key/value statement with its line, its table and the offsets the patch planner edits
// (patch.ts), and `checkAddressKeys` gives E_TOML_KEY_SPELLING for a [functions] or [symbols] key that is not
// `0x` and eight upper-case hex digits and E_DUPLICATE_ADDRESS for an address defined twice, both with line
// numbers. The outline is tolerant: a text smol-toml would refuse still outlines as far as it reads, and
// parse.ts reports the syntax error itself. Pure; never throws.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareNumbers } from '../../foundation/util/sorted.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';

/** A table header: `[a.b]` or `[[a]]`. */
export interface TomlHeader {
  /** 1-based. */
  readonly line: number;
  readonly path: readonly string[];
  /** `[[…]]`: an element of an array of tables. */
  readonly array: boolean;
  /** For an array header, which element of its array it opens (0 for the first `[[modules]]`); -1 otherwise. */
  readonly index: number;
  /** Offset of the end of the header's line (its newline, or the text's end). */
  readonly lineEnd: number;
}

/** A `key = value` statement. Offsets index the text; lines are 1-based. */
export interface TomlKeyValue {
  readonly line: number;
  /** The line the value ends on; equal to `line` for a single-line statement. */
  readonly endLine: number;
  /** The header path in force (empty before the first header). */
  readonly table: readonly string[];
  /** The array element the statement belongs to (TomlHeader.index), or -1 outside an array of tables. */
  readonly tableIndex: number;
  /** The dotted key's segments, unquoted. */
  readonly key: readonly string[];
  /** Offset of the line's first character. */
  readonly lineStart: number;
  /** Offset of the key's first character. */
  readonly start: number;
  /** Offset just past the value. */
  readonly valueEnd: number;
  /** Offset of a trailing comment's `#` on the value's last line, or -1. */
  readonly comment: number;
  /** Offset of the end of the value's last line (its newline, or the text's end). */
  readonly lineEnd: number;
}

export interface TomlOutline {
  readonly headers: readonly TomlHeader[];
  readonly keys: readonly TomlKeyValue[];
}

/** The tables whose keys are addresses. */
export const ADDRESS_TABLES = ['functions', 'symbols'] as const;
export type AddressTable = (typeof ADDRESS_TABLES)[number];

const ADDRESS_KEY = /^0x[0-9A-F]{8}$/;
const HEX_LIKE = /^0[xX]([0-9a-fA-F]+)$/;
const BARE_KEY = /[A-Za-z0-9_-]/;

/** Whether `key` is spelled as an address key must be: `0x` and eight upper-case hex digits. */
export function isAddressKey(key: string): boolean {
  return ADDRESS_KEY.test(key);
}

/** The key an address is written under (`0x08000470`). */
export function addressKey(addr: Addr): string {
  return hexAddr(addr);
}

/** The address a hex-looking key names whatever its spelling (`0x8000470` is 0x08000470), or undefined. */
export function addressOfKey(key: string): Addr | undefined {
  const digits = HEX_LIKE.exec(key)?.[1];
  if (digits === undefined) return undefined;
  const value = Number.parseInt(digits, 16);
  return value <= 0xffff_ffff ? value : undefined;
}

// ---------------------------------------------------------------------------------------------------
// The outline scanner.

interface Cursor {
  readonly text: string;
  pos: number;
}

function isBlank(c: string | undefined): boolean {
  return c === ' ' || c === '\t';
}

function skipBlanks(cx: Cursor): void {
  while (isBlank(cx.text[cx.pos])) cx.pos++;
}

/** Offset of the end of the line holding `pos`: its `\n` (or `\r\n`), or the text's end. */
function endOfLine(text: string, pos: number): number {
  const nl = text.indexOf('\n', pos);
  const end = nl < 0 ? text.length : nl;
  return end > pos && text[end - 1] === '\r' ? end - 1 : end;
}

/** Moves past the line holding the cursor, its newline included. */
function skipLine(cx: Cursor): void {
  const nl = cx.text.indexOf('\n', cx.pos);
  cx.pos = nl < 0 ? cx.text.length : nl + 1;
}

const ESCAPES: Readonly<Record<string, string>> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\u001b', '"': '"', '\\': '\\' };

/** A one-line basic string starting at the cursor's `"`; the decoded text, or undefined if it never closes. */
function basicString(cx: Cursor): string | undefined {
  let out = '';
  cx.pos++;
  for (;;) {
    const c = cx.text[cx.pos];
    if (c === undefined || c === '\n') return undefined;
    cx.pos++;
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const e = cx.text[cx.pos] ?? '';
    cx.pos++;
    const simple = ESCAPES[e];
    if (simple !== undefined) {
      out += simple;
    } else if (e === 'u' || e === 'U' || e === 'x') {
      const width = e === 'u' ? 4 : e === 'U' ? 8 : 2;
      const code = Number.parseInt(cx.text.slice(cx.pos, cx.pos + width), 16);
      cx.pos += width;
      out += Number.isNaN(code) || code > 0x10ffff ? '' : String.fromCodePoint(code);
    }
  }
}

/** A one-line literal string starting at the cursor's `'`. */
function literalString(cx: Cursor): string | undefined {
  const close = cx.text.indexOf("'", cx.pos + 1);
  const nl = cx.text.indexOf('\n', cx.pos + 1);
  if (close < 0 || (nl >= 0 && nl < close)) return undefined;
  const out = cx.text.slice(cx.pos + 1, close);
  cx.pos = close + 1;
  return out;
}

/** A dotted key at the cursor, up to (not including) `=` or `]`; undefined when malformed. */
function dottedKey(cx: Cursor): string[] | undefined {
  const segments: string[] = [];
  for (;;) {
    skipBlanks(cx);
    const c = cx.text[cx.pos];
    let segment: string | undefined;
    if (c === '"') segment = basicString(cx);
    else if (c === "'") segment = literalString(cx);
    else {
      const from = cx.pos;
      while (BARE_KEY.test(cx.text[cx.pos] ?? '')) cx.pos++;
      segment = cx.pos > from ? cx.text.slice(from, cx.pos) : undefined;
    }
    if (segment === undefined) return undefined;
    segments.push(segment);
    skipBlanks(cx);
    if (cx.text[cx.pos] !== '.') return segments;
    cx.pos++;
  }
}

/** Moves past a multi-line string whose three-quote opener `quote` is at the cursor. */
function skipMultiline(cx: Cursor, quote: '"""' | "'''"): boolean {
  let at = cx.pos + 3;
  for (;;) {
    const close = cx.text.indexOf(quote, at);
    if (close < 0) return false;
    if (quote === '"""') {
      let slashes = 0;
      for (let i = close - 1; i >= at && cx.text[i] === '\\'; i--) slashes++;
      if (slashes % 2 === 1) {
        at = close + 1;
        continue;
      }
    }
    let end = close + 3;
    // Up to two quotes may sit before the closing three (`""""` ends a string with one quote in it).
    while (end < close + 5 && cx.text[end] === quote[0]) end++;
    cx.pos = end;
    return true;
  }
}

/** Moves past one value at the cursor; false when it does not end (an unclosed string or bracket). */
function skipValue(cx: Cursor): boolean {
  const { text } = cx;
  const c = text[cx.pos];
  if (text.startsWith('"""', cx.pos)) return skipMultiline(cx, '"""');
  if (text.startsWith("'''", cx.pos)) return skipMultiline(cx, "'''");
  if (c === '"') return basicString(cx) !== undefined;
  if (c === "'") return literalString(cx) !== undefined;
  if (c === '[' || c === '{') {
    let depth = 0;
    while (cx.pos < text.length) {
      const d = text[cx.pos];
      if (d === '"' || d === "'") {
        if (!skipValue(cx)) return false;
        continue;
      }
      if (d === '#') {
        const nl = text.indexOf('\n', cx.pos);
        cx.pos = nl < 0 ? text.length : nl;
        continue;
      }
      cx.pos++;
      if (d === '[' || d === '{') depth++;
      else if (d === ']' || d === '}') {
        depth--;
        if (depth === 0) return true;
      }
    }
    return false;
  }
  // A bare value (number, boolean, date): up to a blank, a comment or the line's end.
  const from = cx.pos;
  while (cx.pos < text.length && !/[\s#,\]}]/.test(text[cx.pos] ?? '')) cx.pos++;
  return cx.pos > from;
}

/** Binary search: the 1-based line of `offset`, given the offsets each line starts at. */
function lineAt(lineStarts: readonly number[], offset: number): number {
  const i = lowerBound(lineStarts, offset + 1, (s) => s);
  return Math.max(1, i);
}

/** Every header and key/value statement of `text`, in text order. */
export function outlineToml(text: string): TomlOutline {
  const lineStarts: number[] = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  const headers: TomlHeader[] = [];
  const keys: TomlKeyValue[] = [];
  const arrayCounts = new Map<string, number>();
  let table: readonly string[] = [];
  let tableIndex = -1;
  const cx: Cursor = { text, pos: 0 };
  while (cx.pos < text.length) {
    skipBlanks(cx);
    const c = text[cx.pos];
    if (c === undefined) break;
    if (c === '\n' || c === '\r' || c === '#') {
      skipLine(cx);
      continue;
    }
    const lineStart = lineStarts[lineAt(lineStarts, cx.pos) - 1] ?? 0;
    if (c === '[') {
      const array = text[cx.pos + 1] === '[';
      cx.pos += array ? 2 : 1;
      const path = dottedKey(cx);
      const closer = array ? ']]' : ']';
      if (path === undefined || !text.startsWith(closer, cx.pos)) {
        skipLine(cx);
        continue;
      }
      cx.pos += closer.length;
      const id = path.join('\u0000');
      const index = array ? (arrayCounts.get(id) ?? 0) : -1;
      if (array) arrayCounts.set(id, index + 1);
      headers.push({ line: lineAt(lineStarts, lineStart), path, array, index, lineEnd: endOfLine(text, cx.pos) });
      table = path;
      tableIndex = index;
      skipLine(cx);
      continue;
    }
    const start = cx.pos;
    const key = dottedKey(cx);
    if (key === undefined || text[cx.pos] !== '=') {
      skipLine(cx);
      continue;
    }
    cx.pos++;
    skipBlanks(cx);
    if (!skipValue(cx)) {
      skipLine(cx);
      continue;
    }
    const valueEnd = cx.pos;
    skipBlanks(cx);
    const comment = text[cx.pos] === '#' ? cx.pos : -1;
    const lineEnd = endOfLine(text, valueEnd);
    keys.push({
      line: lineAt(lineStarts, start),
      endLine: lineAt(lineStarts, Math.max(start, valueEnd - 1)),
      table,
      tableIndex,
      key,
      lineStart,
      start,
      valueEnd,
      comment,
      lineEnd,
    });
    skipLine(cx);
  }
  return { headers, keys };
}

// ---------------------------------------------------------------------------------------------------
// Address keys.

/** How an address entry is written. */
export type AddressShape =
  /** `0x… = value` under `[functions]` (or `functions.0x… = value` at the top). */
  | 'line'
  /** A `[functions.0x…]` table of its own. */
  | 'table'
  /** A dotted key or sub-table below the address (`0x….name = "…"`, `[functions.0x….x]`). */
  | 'part';

/** One place an address key is written. */
export interface AddressKeyUse {
  readonly table: AddressTable;
  /** The key as written, unquoted. */
  readonly spelling: string;
  /** The address it names whatever its spelling; undefined when it is not hex at all. */
  readonly addr: Addr | undefined;
  readonly line: number;
  readonly shape: AddressShape;
  /** For a 'line': whether the value ends on the key's line. */
  readonly singleLine: boolean;
  /** For a 'line': its statement in the outline. */
  readonly statement?: TomlKeyValue;
}

function isAddressTable(name: string | undefined): name is AddressTable {
  return name === 'functions' || name === 'symbols';
}

/** Every use of an address key in the outline, in text order. */
export function addressKeyUses(outline: TomlOutline): AddressKeyUse[] {
  const uses: { readonly at: number; readonly use: AddressKeyUse }[] = [];
  for (const header of outline.headers) {
    const [table, spelling] = header.path;
    if (header.array || !isAddressTable(table) || spelling === undefined) continue;
    const shape: AddressShape = header.path.length === 2 ? 'table' : 'part';
    uses.push({ at: header.line, use: { table, spelling, addr: addressOfKey(spelling), line: header.line, shape, singleLine: true } });
  }
  for (const statement of outline.keys) {
    if (statement.tableIndex >= 0) continue;
    const path = [...statement.table, ...statement.key];
    const [table, spelling] = path;
    if (!isAddressTable(table) || spelling === undefined || path.length < 2) continue;
    const shape: AddressShape = path.length === 2 ? 'line' : 'part';
    uses.push({
      at: statement.line,
      use: {
        table,
        spelling,
        addr: addressOfKey(spelling),
        line: statement.line,
        shape,
        singleLine: statement.endLine === statement.line,
        ...(shape === 'line' ? { statement } : {}),
      },
    });
  }
  return uses.sort((a, b) => compareNumbers(a.at, b.at)).map((u) => u.use);
}

/** One definition of an address: a line, a table, or the parts written under one spelling. */
export interface AddressDefinition {
  readonly table: AddressTable;
  readonly addr: Addr;
  readonly line: number;
  readonly shape: AddressShape;
  readonly use: AddressKeyUse;
}

/**
 * The definitions of each address per table: every 'line' and every 'table' is one, and the 'part's written
 * under one spelling are one together unless that spelling also has a 'table' (whose body they are).
 */
export function addressDefinitions(uses: readonly AddressKeyUse[]): AddressDefinition[] {
  const out: AddressDefinition[] = [];
  const spellingsWithTable = new Set(uses.filter((u) => u.shape === 'table').map((u) => `${u.table} ${u.spelling}`));
  const partSeen = new Set<string>();
  for (const use of uses) {
    if (use.addr === undefined) continue;
    const id = `${use.table} ${use.spelling}`;
    if (use.shape === 'part') {
      if (spellingsWithTable.has(id) || partSeen.has(id)) continue;
      partSeen.add(id);
    }
    out.push({ table: use.table, addr: use.addr, line: use.line, shape: use.shape, use });
  }
  return out;
}

/** The definitions of every address defined more than once, each group in text order, the groups by first line. */
export function duplicateDefinitions(uses: readonly AddressKeyUse[]): AddressDefinition[][] {
  const byAddress = new Map<string, AddressDefinition[]>();
  for (const definition of addressDefinitions(uses)) {
    const id = `${definition.table} ${definition.addr}`;
    const list = byAddress.get(id);
    if (list === undefined) byAddress.set(id, [definition]);
    else list.push(definition);
  }
  return [...byAddress.values()].filter((list) => list.length > 1);
}

function lineList(lines: readonly number[]): string {
  if (lines.length <= 1) return `line ${lines[0] ?? '?'}`;
  return `lines ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1] ?? '?'}`;
}

const TIMES = ['', 'once', 'twice'];

/** E_TOML_KEY_SPELLING for each misspelt address key and E_DUPLICATE_ADDRESS for each address defined twice. */
export function checkAddressKeys(outline: TomlOutline): Diagnostic<ConfigCode>[] {
  const uses = addressKeyUses(outline);
  const out: { readonly line: number; readonly d: Diagnostic<ConfigCode> }[] = [];
  const reported = new Set<string>();
  for (const use of uses) {
    const id = `${use.table} ${use.spelling}`;
    if (isAddressKey(use.spelling) || reported.has(id)) continue;
    reported.add(id);
    const hint = use.addr === undefined ? 'an address such as 0x08000470' : addressKey(use.addr);
    out.push({
      line: use.line,
      d: diagnostic(
        ConfigCodes,
        'E_TOML_KEY_SPELLING',
        `line ${use.line}: [${use.table}] key ${use.spelling} is not 0x followed by eight upper-case hex digits; write ${hint}`,
        use.addr === undefined ? {} : { addr: use.addr },
      ),
    });
  }
  for (const list of duplicateDefinitions(uses)) {
    const first = list[0];
    if (first === undefined) continue;
    const lines = list.map((d) => d.line);
    const again = lines[1] ?? first.line;
    const times = TIMES[list.length] ?? `${list.length} times`;
    out.push({
      line: again,
      d: diagnostic(ConfigCodes, 'E_DUPLICATE_ADDRESS', `line ${again}: [${first.table}] lists ${addressKey(first.addr)} ${times}, at ${lineList(lines)}`, {
        addr: first.addr,
      }),
    });
  }
  return out.sort((a, b) => compareNumbers(a.line, b.line) || (a.d.code < b.d.code ? -1 : a.d.code > b.d.code ? 1 : 0)).map((o) => o.d);
}
