// The C tokenizer (architecture §6.6): the one reader of C text in romlift. Every other reader of a C file (the
// INCLUDE_ASM planner, the text-layout check of a C unit, phase 6's identifier renames (D76 g)) works on its tokens, so a
// comment, a string or a preprocessor line is never mistaken for code: no regex ever runs over C.
//
// The tokens are those of translation phase 3 with the parts romlift needs: comments (`/* … */`, `// …`), string
// literals, character literals, preprocessor lines (from a `#` that is the first non-blank character of a line to
// the end of the line, line splices and comments that span lines included), identifiers (with GCC's `$`),
// pp-numbers and punctuators (longest match). Whitespace is not a token. Anything else (a stray `\`, `@`, a
// non-ASCII character) is one `other` token per character. Every token carries its UTF-16 offsets and the 1-based
// line it starts on. The text a comment, string, character literal or preprocessor line runs to the end of is a
// token with `terminated: false`; the tokenizer never fails. A byte order mark (U+FEFF) at offset 0 is no token, and
// the first line still starts after it, as the host preprocessor reads such a file (fix round 2, correctness-a0-3).

/** What a token is. */
export type CTokenKind =
  | 'comment'
  | 'string'
  | 'char'
  | 'preprocessor'
  | 'identifier'
  | 'number'
  | 'punctuator'
  | 'other';

export interface CToken {
  readonly kind: CTokenKind;
  /** UTF-16 offsets into the text: [start, end). */
  readonly start: number;
  readonly end: number;
  /** The 1-based line `start` is on. */
  readonly line: number;
  /** text.slice(start, end). */
  readonly text: string;
  /** False when the text ends inside the token (a comment, literal or preprocessor line left open). */
  readonly terminated: boolean;
}

/** The punctuators of C with more than one character, longest first so the first match is the longest. */
const LONG_PUNCTUATORS: readonly string[] = [
  '...',
  '<<=',
  '>>=',
  '->',
  '++',
  '--',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '*=',
  '/=',
  '%=',
  '+=',
  '-=',
  '&=',
  '^=',
  '|=',
  '##',
];

/** The punctuators of C with one character. */
const SHORT_PUNCTUATORS = '[](){}.&*+-~!/%<>^|?:;=,#';

function isIdentifierStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

function isIdentifierPart(c: string): boolean {
  return isIdentifierStart(c) || isDigit(c);
}

/** Horizontal and vertical blanks other than the newline. */
function isBlank(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\v' || c === '\f';
}

/** The tokenizer's position: the offset, the line it is on, and whether only blanks precede it on that line. */
interface Cursor {
  readonly text: string;
  at: number;
  line: number;
  lineStart: boolean;
}

/** The length of a line splice (a backslash, blanks a lenient compiler allows, then a newline) at `at`, or 0. */
function spliceAt(text: string, at: number): number {
  if (text[at] !== '\\') return 0;
  if (text[at + 1] === '\n') return 2;
  if (text[at + 1] === '\r' && text[at + 2] === '\n') return 3;
  return 0;
}

/** Advances past `n` characters, counting the newlines among them. */
function advance(c: Cursor, n: number): void {
  for (let k = 0; k < n && c.at < c.text.length; k++) {
    if (c.text[c.at] === '\n') c.line++;
    c.at++;
  }
}

/** A block comment from its `/*`; true when its `*\/` was found. */
function blockComment(c: Cursor): boolean {
  advance(c, 2);
  while (c.at < c.text.length) {
    if (c.text[c.at] === '*' && c.text[c.at + 1] === '/') {
      advance(c, 2);
      return true;
    }
    advance(c, 1);
  }
  return false;
}

/** A line comment from its `//` to the newline (not included), across line splices; always terminated. */
function lineComment(c: Cursor): void {
  advance(c, 2);
  while (c.at < c.text.length && c.text[c.at] !== '\n') advance(c, Math.max(1, spliceAt(c.text, c.at)));
}

/** A string or character literal from its opening quote; true when its closing quote was found on its line. */
function literal(c: Cursor, quote: string): boolean {
  advance(c, 1);
  while (c.at < c.text.length) {
    const ch = c.text[c.at];
    if (ch === quote) {
      advance(c, 1);
      return true;
    }
    if (ch === '\n') return false;
    if (ch === '\\') {
      const splice = spliceAt(c.text, c.at);
      advance(c, splice > 0 ? splice : 2);
      continue;
    }
    advance(c, 1);
  }
  return false;
}

/**
 * A preprocessor line from its `#` to the newline (not included): line splices continue it, and so does a block
 * comment that spans lines; a quote inside it opens a literal, so `"//"` in an `#include` is no comment. True when
 * nothing inside it was left open.
 */
function directive(c: Cursor): boolean {
  advance(c, 1);
  let terminated = true;
  while (c.at < c.text.length && c.text[c.at] !== '\n') {
    const ch = c.text[c.at];
    const splice = spliceAt(c.text, c.at);
    if (splice > 0) advance(c, splice);
    else if (ch === '/' && c.text[c.at + 1] === '*') terminated = blockComment(c) && terminated;
    else if (ch === '/' && c.text[c.at + 1] === '/') lineComment(c);
    else if (ch === '"' || ch === "'") terminated = literal(c, ch) && terminated;
    else advance(c, 1);
  }
  return terminated;
}

/** A pp-number from its first digit (or `.` and digit): digits, letters, `_`, `.` and an exponent's sign. */
function ppNumber(c: Cursor): void {
  advance(c, 1);
  while (c.at < c.text.length) {
    const ch = c.text[c.at] ?? '';
    const prev = c.text[c.at - 1] ?? '';
    if (isIdentifierPart(ch) || ch === '.') advance(c, 1);
    else if ((ch === '+' || ch === '-') && (prev === 'e' || prev === 'E' || prev === 'p' || prev === 'P'))
      advance(c, 1);
    else break;
  }
}

/** The length of the punctuator at `at`, or 0. */
function punctuatorAt(text: string, at: number): number {
  for (const p of LONG_PUNCTUATORS) if (text.startsWith(p, at)) return p.length;
  return SHORT_PUNCTUATORS.includes(text[at] ?? '\0') ? 1 : 0;
}

/** Scans one token at the cursor (which is on a non-blank character) and returns its kind and whether it closed. */
function scanToken(c: Cursor): { readonly kind: CTokenKind; readonly terminated: boolean } {
  const { text } = c;
  const ch = text[c.at] ?? '';
  const next = text[c.at + 1] ?? '';
  if (ch === '/' && next === '*') return { kind: 'comment', terminated: blockComment(c) };
  if (ch === '/' && next === '/') {
    lineComment(c);
    return { kind: 'comment', terminated: true };
  }
  if (ch === '#' && c.lineStart) return { kind: 'preprocessor', terminated: directive(c) };
  if (ch === '"') return { kind: 'string', terminated: literal(c, '"') };
  if (ch === "'") return { kind: 'char', terminated: literal(c, "'") };
  if (isIdentifierStart(ch)) {
    while (c.at < text.length && isIdentifierPart(text[c.at] ?? '')) advance(c, 1);
    return { kind: 'identifier', terminated: true };
  }
  if (isDigit(ch) || (ch === '.' && isDigit(next))) {
    ppNumber(c);
    return { kind: 'number', terminated: true };
  }
  const punctuator = punctuatorAt(text, c.at);
  if (punctuator > 0) {
    advance(c, punctuator);
    return { kind: 'punctuator', terminated: true };
  }
  advance(c, 1);
  return { kind: 'other', terminated: true };
}

/** The tokens of a C text, in order. Never throws: an unclosed comment, literal or directive is a token with `terminated: false`. */
export function tokenizeC(text: string): readonly CToken[] {
  const tokens: CToken[] = [];
  const c: Cursor = { text, at: text.charCodeAt(0) === 0xfeff ? 1 : 0, line: 1, lineStart: true };
  while (c.at < text.length) {
    const ch = text[c.at] ?? '';
    if (ch === '\n') {
      advance(c, 1);
      c.lineStart = true;
      continue;
    }
    if (isBlank(ch)) {
      advance(c, 1);
      continue;
    }
    const splice = spliceAt(text, c.at);
    if (splice > 0) {
      // A line splice between tokens joins two lines into one; a `#` after it is not at a line's start.
      advance(c, splice);
      continue;
    }
    const start = c.at;
    const line = c.line;
    const { kind, terminated } = scanToken(c);
    tokens.push({ kind, start, end: c.at, line, text: text.slice(start, c.at), terminated });
    // A comment keeps a line's start (`/* x */ #define` is a directive); any other token ends it.
    if (kind !== 'comment') c.lineStart = false;
  }
  return tokens;
}

/** Whether a token is a comment or a preprocessor line, which carry no C syntax for the planner. */
export function isTrivia(token: CToken): boolean {
  return token.kind === 'comment' || token.kind === 'preprocessor';
}

/**
 * The keywords of C (C99 and C11, with GCC's spellings agbcc reads), which no identifier the planner or `rename` writes
 * may be (architecture-14: the one table of C's lexical rules lives beside the tokenizer).
 */
export const C_KEYWORDS: ReadonlySet<string> = new Set([
  'asm',
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'register',
  'restrict',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'typeof',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  '_Bool',
  '_Complex',
  '_Imaginary',
  '_Alignas',
  '_Alignof',
  '_Atomic',
  '_Generic',
  '_Noreturn',
  '_Static_assert',
  '_Thread_local',
  '__asm__',
  '__attribute__',
  '__inline__',
  '__typeof__',
  '__volatile__',
  '__const__',
  '__signed__',
  '__extension__',
  '__label__',
  '__restrict__',
]);

/** A preprocessor line read as a directive: its name, and the tokens of its body after the name. */
export interface CDirective {
  /** The directive's name (`define`, `ifdef`, …); '' for a null directive or a line whose first token is no identifier. */
  readonly name: string;
  /** Every token after the name (all past the `#` when there is none), at their offsets in the whole text. */
  readonly body: readonly CToken[];
}

/**
 * A preprocessor line (a `preprocessor` token, or any `{ text, start }` whose text starts with `#`) as a directive,
 * read with the tokenizer from just past its `#`, so a comment or a line splice between the `#` and the name is
 * whitespace, as the preprocessor reads it: `#  ifdef X` is `ifdef` with the body `X`.
 */
export function directiveOf(line: { readonly text: string; readonly start: number }): CDirective {
  const tokens = tokenizeC(line.text.slice(1)).map((t) => ({
    ...t,
    start: t.start + line.start + 1,
    end: t.end + line.start + 1,
  }));
  const first = tokens.findIndex((t) => t.kind !== 'comment');
  const head = tokens[first];
  if (head === undefined || head.kind !== 'identifier') return { name: '', body: tokens };
  return { name: head.text, body: tokens.slice(first + 1) };
}
