// The parser of the directive subset romlift emits (architecture §6.4, D49): the text the writers print
// and foundation/asm/dialect.ts defines, read back into statements that foundation/asm/layout.ts lays
// out to bytes without a toolchain. The grammar is GNU as's, restricted to what romlift writes:
//
//   comments    `@` to the end of the line (outside a string); `;` separates statements on a line
//   labels      `name:`, several on a line, optionally followed by a statement
//   no bytes    `.syntax unified`, `.text`, `.global`/`.globl`, `.type n, %function`, `.size n, .-n`,
//               `.thumb_func` (kind 'symbol'; `.thumb_func` also selects Thumb state, as in GNU as)
//   mode        `.thumb`, `.arm`, `.code 16`, `.code 32`
//   padding     `.align p` and `.align p, fill` (there is no `.balign`)
//   data        `.byte`, `.2byte`/`.hword`, `.4byte`/`.word`: comma lists of `number`, `symbol`,
//               `symbol + number` or `symbol - number` (decimal or 0x hex; a leading 0 is refused
//               because GNU as reads it as octal)
//   raw words   `.inst.n 0xXXXX` (Thumb), `.inst.w 0xXXXXYYYY` (a Thumb bl pair), `.inst 0xXXXXXXXX` (ARM)
//   files       `.incbin "file", offset, length`; `.include "path"`
//   macros      `.macro name params` … `.endm`, defined in the text or in an included macro file
//               (DIALECT.macrosInc), and invocations expanded by substituting `\param` (and `\()`)
//   otherwise   an instruction text, read by foundation/isa `parse` when the layouter encodes it
//
// An include whose text in `options.includes` defines macros is read for its macros and leaves no
// statement; any other include is an 'include' statement the caller resolves. Expanded statements keep
// the line of the invocation. Errors are values with their 1-based line; nothing throws for content.
import type { Mode } from '../rom/span.ts';

/** A data value: a number, or a symbol plus a signed addend. */
export type Expr =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'symbol'; readonly name: string; readonly addend: number };

/** The `.inst` spellings; `.inst.n` is a Thumb halfword, `.inst.w` a Thumb pair, `.inst` an ARM word. */
export type InstDirective = '.inst' | '.inst.n' | '.inst.w';

/**
 * One statement of an assembly text (frozen, D49). Every statement carries the 1-based line of the text
 * it came from (for a macro expansion, the invoking line).
 *
 * - `label`: defines `name` at the running address.
 * - `mode`: selects Thumb or ARM state (`.thumb`, `.arm`, `.code 16`, `.code 32`).
 * - `align`: pads to 2^power; `fill` is the pad byte, absent when the text gives none (GNU as then pads a
 *   code section with no-ops).
 * - `data`: `values.length` little-endian values of `width` bytes.
 * - `inst`: a raw instruction of `width` bytes; `word` uses the decoder's convention (a Thumb pair is
 *   first halfword | second halfword << 16), so laying it out is a little-endian write.
 * - `insn`: an instruction text without its comment.
 * - `incbin`: `length` bytes of `file` from `offset`.
 * - `include`: a file the caller resolves (not a macro file).
 * - `symbol`: a directive that emits no bytes (`.syntax`, `.text`, `.global`, `.globl`, `.type`, `.size`,
 *   `.thumb_func`) with its arguments.
 */
export type Statement =
  | { readonly kind: 'label'; readonly line: number; readonly name: string }
  | { readonly kind: 'mode'; readonly line: number; readonly mode: Mode }
  | { readonly kind: 'align'; readonly line: number; readonly power: number; readonly fill?: number }
  | { readonly kind: 'data'; readonly line: number; readonly width: 1 | 2 | 4; readonly values: readonly Expr[] }
  | { readonly kind: 'inst'; readonly line: number; readonly directive: InstDirective; readonly width: 2 | 4; readonly word: number }
  | { readonly kind: 'insn'; readonly line: number; readonly text: string }
  | { readonly kind: 'incbin'; readonly line: number; readonly file: string; readonly offset: number; readonly length: number }
  | { readonly kind: 'include'; readonly line: number; readonly path: string }
  | { readonly kind: 'symbol'; readonly line: number; readonly directive: string; readonly args: readonly string[] };

export type StatementKind = Statement['kind'];

/** A line the parser could not read. */
export interface StatementError {
  readonly line: number;
  readonly message: string;
}

export interface ParseOptions {
  /** Texts of included files by path, as written in `.include "path"`. */
  readonly includes: ReadonlyMap<string, string>;
}

export interface ParsedStatements {
  readonly statements: readonly Statement[];
  readonly errors: readonly StatementError[];
}

/** The largest `.align` power accepted (romlift emits 2; GNU as refuses far larger ones). */
export const MAX_ALIGN_POWER = 15;

/** How deep macro invocations may nest before the expansion is refused as recursive. */
const MAX_MACRO_DEPTH = 32;

interface MacroLine {
  readonly text: string;
  /** The line of the definition, for errors in a macro file. */
  readonly line: number;
}

interface Macro {
  readonly params: readonly string[];
  readonly body: readonly MacroLine[];
}

const NAME = /^[A-Za-z_.$][A-Za-z0-9_.$]*$/;
const LABEL = /^([A-Za-z_.$][A-Za-z0-9_.$]*):/;
const PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STRING = /^"([^"\\]*)"$/;
const NUMBER = /^-?(?:0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/;
const EXPR = /^([A-Za-z_.$][A-Za-z0-9_.$]*)(?:\s*([+-])\s*(0x[0-9a-fA-F]+|0|[1-9][0-9]*))?$/;
const MACRO_FILE = /^[ \t]*\.macro\b/m;

/** The value of a decimal or 0x-hex number (optionally negative); undefined for anything else. */
export function parseNumber(text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined;
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const value = digits.startsWith('0x') ? Number.parseInt(digits.slice(2), 16) : Number.parseInt(digits, 10);
  return negative ? -value : value;
}

/** A data expression, or an error message. */
export function parseExpr(text: string): Expr | string {
  const value = parseNumber(text);
  if (value !== undefined) return { kind: 'number', value };
  if (text === '.') return 'the location counter `.` is not supported';
  const m = EXPR.exec(text);
  if (m === null) return `unreadable expression \`${text}\``;
  const name = m[1] ?? '';
  const addend = m[3] === undefined ? 0 : (parseNumber(m[3]) ?? 0);
  return { kind: 'symbol', name, addend: m[2] === '-' ? -addend : addend };
}

/** `text` without its `@` comment (a `@` inside a string does not start one). */
export function stripComment(text: string): string {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === '@' && !quoted) return text.slice(0, i);
  }
  return text;
}

/** `text` split at each `separator` outside a string. */
function splitOutsideStrings(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (c === separator && !quoted) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** The comma-separated arguments of a directive, trimmed; [] for none. */
function commaArgs(text: string): string[] {
  return text === '' ? [] : splitOutsideStrings(text, ',').map((a) => a.trim());
}

/** The text of a `"..."` string argument, or undefined. */
function stringArg(text: string): string | undefined {
  return STRING.exec(text)?.[1];
}

const DATA_WIDTHS: Readonly<Record<string, 1 | 2 | 4>> = { '.byte': 1, '.2byte': 2, '.hword': 2, '.4byte': 4, '.word': 4 };
const INST_WIDTHS: Readonly<Record<InstDirective, 2 | 4>> = { '.inst': 4, '.inst.n': 2, '.inst.w': 4 };
const INST_LIMITS: Readonly<Record<InstDirective, number>> = { '.inst': 0xffff_ffff, '.inst.n': 0xffff, '.inst.w': 0xffff_ffff };

function isInstDirective(d: string): d is InstDirective {
  return d === '.inst' || d === '.inst.n' || d === '.inst.w';
}

/** The parser's state across one text: its output, the macros defined so far and the include stack. */
interface Reader {
  readonly statements: Statement[];
  readonly errors: StatementError[];
  readonly macros: Map<string, Macro>;
  readonly includes: ReadonlyMap<string, string>;
  /** A macro being defined, until its `.endm`. */
  defining: { readonly name: string; readonly params: readonly string[]; readonly body: MacroLine[]; readonly line: number } | undefined;
}

/** Reads one directive (lower-cased name, argument text) at `line`. */
function readDirective(r: Reader, directive: string, rest: string, line: number, depth: number): void {
  const err = (message: string): void => {
    r.errors.push({ line, message });
  };
  const args = commaArgs(rest);
  const push = (s: Statement): void => {
    r.statements.push(s);
  };

  if (directive === '.macro') {
    const space = rest.search(/\s/);
    const name = space < 0 ? rest : rest.slice(0, space);
    const paramText = space < 0 ? '' : rest.slice(space + 1).trim();
    const params = paramText === '' ? [] : paramText.split(/\s*,\s*|\s+/);
    if (!NAME.test(name)) return err(`unreadable macro name \`${name}\``);
    const bad = params.find((p) => !PARAM.test(p));
    if (bad !== undefined) return err(`unsupported macro parameter \`${bad}\``);
    r.defining = { name, params, body: [], line };
    return;
  }
  if (directive === '.endm') return err('`.endm` without `.macro`');

  const width = DATA_WIDTHS[directive];
  if (width !== undefined) {
    if (args.length === 0) return err(`\`${directive}\` needs at least one value`);
    const values: Expr[] = [];
    for (const arg of args) {
      const expr = parseExpr(arg);
      if (typeof expr === 'string') return err(expr);
      values.push(expr);
    }
    return push({ kind: 'data', line, width, values });
  }

  if (isInstDirective(directive)) {
    if (args.length === 0) return err(`\`${directive}\` needs a value`);
    for (const arg of args) {
      const value = parseNumber(arg);
      if (value === undefined || value < 0 || value > INST_LIMITS[directive]) return err(`\`${directive}\` value \`${arg}\` is not a number that fits`);
      // `.inst.w 0xXXXXYYYY` stores halfword XXXX first; the decoder's word is first | second << 16.
      const word = directive === '.inst.w' ? ((value >>> 16) | ((value & 0xffff) << 16)) >>> 0 : value;
      push({ kind: 'inst', line, directive, width: INST_WIDTHS[directive], word });
    }
    return;
  }

  switch (directive) {
    case '.thumb':
    case '.arm':
      if (rest !== '') return err(`\`${directive}\` takes no argument`);
      return push({ kind: 'mode', line, mode: directive === '.thumb' ? 'thumb' : 'arm' });
    case '.code':
      if (rest === '16' || rest === '32') return push({ kind: 'mode', line, mode: rest === '16' ? 'thumb' : 'arm' });
      return err(`\`.code ${rest}\`: only 16 and 32 are supported`);
    case '.align': {
      const power = args[0] === undefined ? undefined : parseNumber(args[0]);
      if (power === undefined || power < 0 || power > MAX_ALIGN_POWER || args.length > 2) {
        return err(`\`.align ${rest}\`: expected a power from 0 to ${MAX_ALIGN_POWER} and an optional fill byte`);
      }
      if (args.length === 1) return push({ kind: 'align', line, power });
      const fill = parseNumber(args[1] ?? '');
      if (fill === undefined || fill < 0 || fill > 0xff) return err(`\`.align ${rest}\`: the fill must be a byte`);
      return push({ kind: 'align', line, power, fill });
    }
    case '.incbin': {
      const file = stringArg(args[0] ?? '');
      const offset = parseNumber(args[1] ?? '');
      const length = parseNumber(args[2] ?? '');
      if (file === undefined || offset === undefined || length === undefined || offset < 0 || length < 0 || args.length !== 3) {
        return err(`\`.incbin ${rest}\`: expected "file", offset, length`);
      }
      return push({ kind: 'incbin', line, file, offset, length });
    }
    case '.include': {
      const path = args.length === 1 ? stringArg(args[0] ?? '') : undefined;
      if (path === undefined) return err(`\`.include ${rest}\`: expected one "path"`);
      const text = r.includes.get(path);
      if (text !== undefined && MACRO_FILE.test(text)) return readMacroFile(r, path, text, line, depth);
      return push({ kind: 'include', line, path });
    }
    case '.syntax':
      if (rest !== 'unified') return err(`\`.syntax ${rest}\`: only unified syntax is supported`);
      return push({ kind: 'symbol', line, directive, args: ['unified'] });
    case '.text':
    case '.thumb_func':
      if (rest !== '') return err(`\`${directive}\` takes no argument`);
      return push({ kind: 'symbol', line, directive, args: [] });
    case '.global':
    case '.globl': {
      const bad = args.length === 0 ? '' : args.find((a) => !NAME.test(a));
      if (bad !== undefined) return err(`\`${directive} ${rest}\`: expected symbol names`);
      return push({ kind: 'symbol', line, directive, args });
    }
    case '.type': {
      const [name, type] = args;
      if (args.length !== 2 || name === undefined || !NAME.test(name) || (type !== '%function' && type !== '%object')) {
        return err(`\`.type ${rest}\`: expected name, %function or %object`);
      }
      return push({ kind: 'symbol', line, directive, args: [name, type] });
    }
    case '.size': {
      const [name, size] = args;
      const compact = size?.replace(/\s+/g, '');
      if (args.length !== 2 || name === undefined || !NAME.test(name) || (compact !== `.-${name}` && parseNumber(size ?? '') === undefined)) {
        return err(`\`.size ${rest}\`: expected name, .-name or a number`);
      }
      return push({ kind: 'symbol', line, directive, args: [name, compact === `.-${name}` ? compact : (size ?? '')] });
    }
    default:
      return err(`unsupported directive \`${directive}\``);
  }
}

/** Reads the macro definitions of an included macro file; any other content is an error at the include. */
function readMacroFile(r: Reader, path: string, text: string, line: number, depth: number): void {
  if (depth >= MAX_MACRO_DEPTH) {
    r.errors.push({ line, message: `"${path}" is included deeper than ${MAX_MACRO_DEPTH} (an include cycle?)` });
    return;
  }
  const sub: Reader = { statements: [], errors: [], macros: r.macros, includes: r.includes, defining: undefined };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) readLine(sub, lines[i] ?? '', i + 1, depth + 1);
  if (sub.defining !== undefined) sub.errors.push({ line: sub.defining.line, message: `macro \`${sub.defining.name}\` has no \`.endm\`` });
  for (const e of sub.errors) r.errors.push({ line, message: `in "${path}" line ${e.line}: ${e.message}` });
  const first = sub.statements[0];
  if (first !== undefined) r.errors.push({ line, message: `"${path}" holds macros and also statements (line ${first.line}); a macro file holds only macros` });
}

/** Substitutes the arguments of one invocation into a macro body line. */
function substitute(text: string, params: readonly string[], args: readonly string[]): string {
  return text.replace(/\\(\(\)|[A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => {
    if (name === '()') return '';
    const index = params.indexOf(name);
    return index < 0 ? whole : (args[index] ?? '');
  });
}

/** Expands one macro invocation at `line`. */
function expand(r: Reader, name: string, macro: Macro, rest: string, line: number, depth: number): void {
  if (depth >= MAX_MACRO_DEPTH) {
    r.errors.push({ line, message: `macro \`${name}\` nests deeper than ${MAX_MACRO_DEPTH} (recursive?)` });
    return;
  }
  const args = rest === '' ? [] : rest.includes(',') ? commaArgs(rest) : rest.split(/\s+/);
  if (args.length !== macro.params.length) {
    r.errors.push({ line, message: `macro \`${name}\` takes ${macro.params.length} argument(s), got ${args.length}` });
    return;
  }
  for (const body of macro.body) readLine(r, substitute(body.text, macro.params, args), line, depth + 1);
}

/** Reads one statement (labels already taken off) at `line`. */
function readStatement(r: Reader, text: string, line: number, depth: number): void {
  if (text === '') return;
  const space = text.search(/\s/);
  const head = space < 0 ? text : text.slice(0, space);
  const rest = space < 0 ? '' : text.slice(space + 1).trim();
  if (head.startsWith('.')) return readDirective(r, head.toLowerCase(), rest, line, depth);
  const macro = r.macros.get(head);
  if (macro !== undefined) return expand(r, head, macro, rest, line, depth);
  r.statements.push({ kind: 'insn', line, text });
}

/** Reads one source line: comment, statements separated by `;`, each with its leading labels. */
function readLine(r: Reader, raw: string, line: number, depth: number): void {
  const defining = r.defining;
  if (defining !== undefined) {
    const code = stripComment(raw).trim();
    if (/^\.endm\b/i.test(code)) {
      // GNU as refuses a second definition (a macro file included twice, for one).
      if (r.macros.has(defining.name)) r.errors.push({ line: defining.line, message: `macro \`${defining.name}\` is already defined` });
      else r.macros.set(defining.name, { params: defining.params, body: defining.body });
      r.defining = undefined;
    } else if (/^\.macro\b/i.test(code)) {
      r.errors.push({ line, message: 'nested `.macro` definitions are not supported' });
    } else {
      defining.body.push({ text: raw, line });
    }
    return;
  }
  for (const piece of splitOutsideStrings(stripComment(raw.replace(/\r$/, '')), ';')) {
    let text = piece.trim();
    for (let m = LABEL.exec(text); m !== null; m = LABEL.exec(text)) {
      r.statements.push({ kind: 'label', line, name: m[1] ?? '' });
      text = text.slice(m[0].length).trim();
    }
    readStatement(r, text, line, depth);
    if (r.defining !== undefined) return;
  }
}

/** Parses an assembly text of romlift's directive subset into statements and errors. */
export function parseStatements(text: string, options: ParseOptions): ParsedStatements {
  const r: Reader = { statements: [], errors: [], macros: new Map(), includes: options.includes, defining: undefined };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) readLine(r, lines[i] ?? '', i + 1, 0);
  if (r.defining !== undefined) r.errors.push({ line: r.defining.line, message: `macro \`${r.defining.name}\` has no \`.endm\`` });
  return { statements: r.statements, errors: r.errors };
}
