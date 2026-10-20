// The INCLUDE_ASM planner (architecture §6.3 `c-stub`, §6.6, D74 e): reads a C file through the tokenizer and
// says what it holds at file scope, then plans the edits that bring its stubs in line with its module's functions.
//
// scanC splits the file's tokens (c-tokens.ts) at brace and parenthesis depth 0 into top-level items:
// - an INCLUDE_ASM statement: exactly `INCLUDE_ASM ( "<dir>" , <name> ) ;` (comments may sit between the tokens);
// - a function definition: `… ident ( … ) {` at depth 0, through its matching `}` (no `=` before the `(`);
// - anything else that is code (a declaration, a prototype, a typedef, stray tokens): an `other` item, up to its
//   `;` at depth 0 or the end of the text;
// comments and preprocessor lines are kept apart (`directives`), never part of an item.
//
// planIncludeAsm inserts a stub, `includeAsmStatement(module, name)` on a line of its own, for every wanted function
// that the file neither includes nor defines, at its ROM-order position: after the nearest earlier wanted function the
// file holds, else before the nearest later one, else at the end. A function the file defines counts as held (its
// stub was replaced by C). It removes every stub of the module's own directory (`asm/nonmatchings/<module>`) whose
// name is not wanted: a function the TOML renamed, deleted or moved to another module, whose file `generate` no longer
// writes there (D75 b; a move is this removal plus the insertion in the other module's file). A removed stub alone on
// its line takes the line with it; one that shares its line keeps the rest of it. A stub of another directory and a
// definition are never removed. W_C_ORDER when the file holds the wanted functions in another order than ROM order;
// the edits never reorder. Every edit is an insertion between tokens or the removal of a whole statement (and its
// line's blanks), so no comment, string or directive changes.
import { includeAsmStatement, NONMATCHINGS_ROOT } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { tokenizeC, isTrivia } from './c-tokens.ts';
import type { CToken } from './c-tokens.ts';
import { ReconcileCodes } from './codes.ts';
import type { ReconcileCode } from './codes.ts';
import type { TextEdit } from './text-edit.ts';

/** The macro every stub calls (include/include_asm.h, foundation/asm/dialect.ts INCLUDE_ASM_HEADER). */
export const INCLUDE_ASM_MACRO = 'INCLUDE_ASM';

/** One `INCLUDE_ASM("<dir>", <name>);` statement at file scope. */
export interface IncludeAsmStatement {
  /** The string literal's value: `asm/nonmatchings/<module>` in a generated stub. */
  readonly dir: string;
  /** The chunk file's base name; the macro includes `<dir>/<name>.s`. */
  readonly name: string;
  /** Offsets of the statement, from `INCLUDE_ASM` to after its `;`. */
  readonly start: number;
  readonly end: number;
  readonly line: number;
}

/** One function definition at file scope. */
export interface CDefinition {
  /** The identifier before its parameter list; '' when that is not an identifier. */
  readonly name: string;
  /** Offsets from its first token to after its closing `}` (or the end of the text when it is not closed). */
  readonly start: number;
  readonly end: number;
  readonly line: number;
}

/** Code at file scope that is neither a stub nor a definition: a declaration, a prototype, stray tokens. */
export interface COther {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  /** Its first token's text, for a message. */
  readonly first: string;
}

/** What a C file holds at file scope, in text order. */
export interface CFileScan {
  readonly statements: readonly IncludeAsmStatement[];
  readonly definitions: readonly CDefinition[];
  readonly others: readonly COther[];
  /** Comments and preprocessor lines. */
  readonly directives: readonly CToken[];
  /** The tokens the text ends inside (an unclosed comment, literal or directive); at most the last one. */
  readonly unterminated: readonly CToken[];
  /** Every token, for callers that place text between them. */
  readonly tokens: readonly CToken[];
}

/** The value of a string literal token whose only escapes are `\\` and `\"`, or undefined. */
function stringValue(token: CToken): string | undefined {
  if (token.kind !== 'string' || !token.terminated || !token.text.startsWith('"')) return undefined;
  const body = token.text.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? '';
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next !== '\\' && next !== '"') return undefined;
    out += next;
    i++;
  }
  return out;
}

function isPunct(token: CToken | undefined, text: string): boolean {
  return token?.kind === 'punctuator' && token.text === text;
}

/** The statement the code tokens of one `;`-closed item spell, or undefined when they spell something else. */
function statementOf(code: readonly CToken[]): IncludeAsmStatement | undefined {
  const [macro, open, dir, comma, name, close, semi] = code;
  if (code.length !== 7 || macro?.kind !== 'identifier' || macro.text !== INCLUDE_ASM_MACRO) return undefined;
  if (!isPunct(open, '(') || !isPunct(comma, ',') || !isPunct(close, ')') || !isPunct(semi, ';')) return undefined;
  const value = dir === undefined ? undefined : stringValue(dir);
  if (value === undefined || name?.kind !== 'identifier' || semi === undefined) return undefined;
  return { dir: value, name: name.text, start: macro.start, end: semi.end, line: macro.line };
}

/**
 * Whether the code tokens before a `{` at depth 0 are a function's head: they end with the `)` that closes a
 * parameter list whose `(` follows an identifier, and hold no `=` at depth 0 (an initializer's braces).
 */
function definitionName(head: readonly CToken[]): string | undefined {
  if (!isPunct(head[head.length - 1], ')')) return undefined;
  let depth = 0;
  let name: string | undefined;
  for (let i = 0; i < head.length; i++) {
    const t = head[i];
    if (isPunct(t, '(') || isPunct(t, '[')) {
      if (depth === 0 && name === undefined) {
        const before = head[i - 1];
        name = before?.kind === 'identifier' ? before.text : '';
      }
      depth++;
    } else if (isPunct(t, ')') || isPunct(t, ']')) depth--;
    else if (depth === 0 && isPunct(t, '=')) return undefined;
  }
  return name;
}

/** What a C text holds at file scope (the module comment above says how it splits). */
export function scanC(text: string): CFileScan {
  const tokens = tokenizeC(text);
  const statements: IncludeAsmStatement[] = [];
  const definitions: CDefinition[] = [];
  const others: COther[] = [];
  const directives = tokens.filter(isTrivia);
  const code = tokens.filter((t) => !isTrivia(t));
  let item: CToken[] = [];
  /** Parentheses and brackets, then braces, inside the current item. */
  let parens = 0;
  let braces = 0;
  let definition: { readonly name: string; readonly first: CToken } | undefined;
  const closeOther = (end: number): void => {
    const first = item[0];
    if (first !== undefined) others.push({ start: first.start, end, line: first.line, first: first.text });
    item = [];
  };
  for (const t of code) {
    if (item.length === 0 && definition === undefined) parens = braces = 0;
    item.push(t);
    if (isPunct(t, '(') || isPunct(t, '[')) parens++;
    else if (isPunct(t, ')') || isPunct(t, ']')) parens = Math.max(0, parens - 1);
    else if (isPunct(t, '{')) {
      if (braces === 0 && parens === 0 && definition === undefined) {
        const name = definitionName(item.slice(0, -1));
        const first = item[0];
        if (name !== undefined && first !== undefined) definition = { name, first };
      }
      braces++;
    } else if (isPunct(t, '}')) {
      braces = Math.max(0, braces - 1);
      if (braces === 0 && definition !== undefined) {
        definitions.push({ name: definition.name, start: definition.first.start, end: t.end, line: definition.first.line });
        definition = undefined;
        item = [];
      }
    } else if (isPunct(t, ';') && braces === 0 && parens === 0 && definition === undefined) {
      const statement = statementOf(item);
      if (statement !== undefined) {
        statements.push(statement);
        item = [];
      } else closeOther(t.end);
    }
  }
  if (definition !== undefined) definitions.push({ name: definition.name, start: definition.first.start, end: text.length, line: definition.first.line });
  else closeOther(text.length);
  const last = tokens[tokens.length - 1];
  return { statements, definitions, others, directives, unterminated: last !== undefined && !last.terminated ? [last] : [], tokens };
}

// ---------------------------------------------------------------------------------------------------
// Planning.

/** The functions a C file must hold: its module, and the chunk files' base names in ROM order. */
export interface IncludeAsmWanted {
  readonly module: string;
  /** The base names of the module's chunk files (core/model/paths.ts chunkPaths), in ROM order. */
  readonly names: readonly string[];
  /** The file's project path, for the diagnostics (`src/<module>.c`). */
  readonly path?: string;
}

export interface IncludeAsmPlan {
  /** Insertions and removals, in text order; apply with applyTextEdits. */
  readonly edits: readonly TextEdit[];
  /** W_C_ORDER, at most once. */
  readonly diagnostics: readonly Diagnostic<ReconcileCode>[];
  /** Wanted names the planner found no safe place for: the text ends inside a comment, literal or directive. */
  readonly unplaced: readonly string[];
}

/** Where a held function sits: offsets of its first token and of its end. */
interface Held {
  readonly start: number;
  readonly end: number;
}

/** The directory an INCLUDE_ASM statement of `module` names. */
export function includeAsmDir(module: string): string {
  return `${NONMATCHINGS_ROOT}/${module}`;
}

/** The functions of `scan` that hold a stub of `dir` or a definition, by name, the first occurrence each. */
function heldByName(scan: CFileScan, dir: string): ReadonlyMap<string, Held> {
  const held = new Map<string, Held>();
  const items = [...scan.statements.filter((s) => s.dir === dir), ...scan.definitions].sort((a, b) => a.start - b.start);
  for (const item of items) if (!held.has(item.name)) held.set(item.name, { start: item.start, end: item.end });
  return held;
}

/** The offset just past the line `offset` is on: past the blanks and comments (by start) that follow it and its newline; whether there was one. */
function afterLine(text: string, comments: ReadonlyMap<number, CToken>, offset: number): { readonly at: number; readonly newline: boolean } {
  let at = offset;
  for (;;) {
    while (text[at] === ' ' || text[at] === '\t') at++;
    const comment = comments.get(at);
    if (comment !== undefined && comment.terminated) {
      at = comment.end;
      continue;
    }
    if (text[at] === '\n') return { at: at + 1, newline: true };
    if (text[at] === '\r' && text[at + 1] === '\n') return { at: at + 2, newline: true };
    return { at, newline: false };
  }
}

/** The offset a stub goes before a held item: its line's start, above the comments that lead into it. */
function beforeItem(text: string, scan: CFileScan, start: number): number {
  const before = scan.tokens.filter((t) => t.end <= start);
  let at = start;
  // Comments directly above the item (only blanks between) are its own: the stub goes above them.
  for (let k = before.length - 1; k >= 0; k--) {
    const t = before[k];
    if (t === undefined || t.kind !== 'comment' || text.slice(t.end, at).trim() !== '') break;
    at = t.start;
  }
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const prev = before.filter((t) => t.end <= at).pop();
  // A token ends on this line before the item (`foo(); INCLUDE_ASM(…)`): the stub goes right before the item.
  return prev !== undefined && prev.end > lineStart ? at : lineStart;
}

/** For each wanted name, the nearest held function before it (`previous`) and after it (`next`) in ROM order. */
function neighbours(names: readonly string[], held: ReadonlyMap<string, Held>): { readonly previous: readonly (Held | undefined)[]; readonly next: readonly (Held | undefined)[] } {
  const previous: (Held | undefined)[] = [];
  const next: (Held | undefined)[] = new Array<Held | undefined>(names.length).fill(undefined);
  let last: Held | undefined;
  for (const name of names) {
    previous.push(last);
    last = held.get(name) ?? last;
  }
  let following: Held | undefined;
  for (let k = names.length - 1; k >= 0; k--) {
    next[k] = following;
    following = held.get(names[k] ?? '') ?? following;
  }
  return { previous, next };
}

/** W_C_ORDER when the held wanted functions are not in ROM order in the text (the first pair out of order). */
function orderDiagnostics(wanted: IncludeAsmWanted, held: ReadonlyMap<string, Held>): Diagnostic<ReconcileCode>[] {
  const order = wanted.names.flatMap((name) => {
    const h = held.get(name);
    return h === undefined ? [] : [{ name, ...h }];
  });
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (prev === undefined || cur === undefined || cur.start > prev.start) continue;
    const where = wanted.path ?? `the C file of module ${wanted.module}`;
    return [diagnostic(ReconcileCodes, 'W_C_ORDER', `${where} holds ${cur.name} before ${prev.name}, which comes first in ROM order`, wanted.path === undefined ? {} : { path: wanted.path })];
  }
  return [];
}

/**
 * The removal of statement `s`: its whole line (from the line's start through its newline) when nothing else is on
 * it, else the statement alone.
 */
function removalOf(text: string, s: IncludeAsmStatement): TextEdit {
  const lineStart = text.lastIndexOf('\n', s.start - 1) + 1;
  let after = s.end;
  while (text[after] === ' ' || text[after] === '\t') after++;
  const lineEnd = text[after] === '\n' ? after + 1 : text[after] === '\r' && text[after + 1] === '\n' ? after + 2 : after === text.length ? after : -1;
  if (lineEnd >= 0 && text.slice(lineStart, s.start).trim() === '') return { start: lineStart, end: lineEnd, text: '', reason: 'remove-stub' };
  return { start: s.start, end: s.end, text: '', reason: 'remove-stub' };
}

/**
 * The edits that add every wanted function `text` neither includes (from `asm/nonmatchings/<module>`) nor defines,
 * each at its ROM-order position, and remove every stub of that directory whose function is not wanted; W_C_ORDER
 * when the file's order of the held ones is not ROM order.
 */
export function planIncludeAsm(text: string, wanted: IncludeAsmWanted): IncludeAsmPlan {
  const scan = scanC(text);
  const dir = includeAsmDir(wanted.module);
  const held = heldByName(scan, dir);
  const { previous, next } = neighbours(wanted.names, held);
  const comments = new Map(scan.directives.filter((t) => t.kind === 'comment').map((t) => [t.start, t] as const));
  const edits: TextEdit[] = [];
  const unplaced: string[] = [];
  wanted.names.forEach((name, k) => {
    if (held.has(name)) return;
    const stub = includeAsmStatement(wanted.module, name);
    const before = previous[k];
    const after = next[k];
    if (before !== undefined) {
      const line = afterLine(text, comments, before.end);
      edits.push({ start: line.at, end: line.at, text: line.newline ? `${stub}\n` : `\n${stub}\n`, reason: 'add-stub' });
    } else if (after !== undefined) {
      const at = beforeItem(text, scan, after.start);
      edits.push({ start: at, end: at, text: `${stub}\n`, reason: 'add-stub' });
    } else if (scan.unterminated.length > 0) {
      unplaced.push(name);
    } else {
      const needsNewline = text.length > 0 && !text.endsWith('\n');
      edits.push({ start: text.length, end: text.length, text: `${needsNewline ? '\n' : ''}${stub}\n`, reason: 'add-stub' });
    }
  });
  const names = new Set(wanted.names);
  for (const statement of scan.statements) if (statement.dir === dir && !names.has(statement.name)) edits.push(removalOf(text, statement));
  return { edits: joinAtOffsets(edits), diagnostics: orderDiagnostics(wanted, held), unplaced };
}

/**
 * The edits in text order (an insertion before a removal at its offset), the insertions at one offset joined into one
 * edit in wanted order, so stubs that follow an unterminated last line get one newline between them, not two
 * (`\nA\n` then `\nB\n` become `\nA\nB\n`).
 */
function joinAtOffsets(edits: readonly TextEdit[]): readonly TextEdit[] {
  const sorted = edits.map((edit, index) => ({ edit, index })).sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index);
  const out: TextEdit[] = [];
  for (const { edit } of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || last.start !== edit.start || last.end !== last.start || edit.end !== edit.start) {
      out.push(edit);
      continue;
    }
    const text = last.text.endsWith('\n') && edit.text.startsWith('\n') ? last.text + edit.text.slice(1) : last.text + edit.text;
    out[out.length - 1] = { ...last, text };
  }
  return out;
}
