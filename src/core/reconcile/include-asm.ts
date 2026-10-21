// The INCLUDE_ASM planner (architecture §6.3 `c-stub`, §6.6, D74 e): reads a C file through the tokenizer and
// says what it holds at file scope, then plans the edits that bring its stubs in line with its module's functions.
//
// scanC splits the file's tokens (c-tokens.ts) at brace and parenthesis depth 0 into top-level items:
// - an INCLUDE_ASM statement: exactly `INCLUDE_ASM ( "<dir>" , <name> ) ;` (comments may sit between the tokens);
// - a function definition: `… ident ( … ) {` at depth 0, through its matching `}` (no `=` before the `(`); its name
//   is the identifier before the first `(` that opens a parameter list rather than a declarator group `(*` (so `B` in
//   `void (*B(void))(void)`), GCC's `__attribute__((…))` and `asm(…)` groups left out (fix round 4, correctness-a2-6);
// - anything else that is code (a declaration, a prototype, a typedef, stray tokens): an `other` item, up to its
//   `;` at depth 0 or the end of the text;
// comments and preprocessor lines are kept apart (`directives`), never part of an item.
// A file the scanner cannot split is unscannable (fix round 4, correctness-a2-2, a2-6), and planIncludeAsm refuses it
// whole with E_C_UNSCANNABLE, an error, so `generate` writes nothing: a branch of an `#if`/`#ifdef`/`#ifndef` that
// leaves the brace or parenthesis depth other than the conditional found it (the scanner counts every branch, so the
// depth after it would be wrong, and a definition could swallow the rest of the file), a definition whose `{` never
// closes, and a `{` at file scope after a head that names no function (a K&R definition, a head the scanner cannot
// read).
//
// planIncludeAsm inserts a stub, `includeAsmStatement(module, stub)` on a line of its own, for every wanted chunk
// that the file neither includes nor defines, at its ROM-order position: after the nearest earlier wanted chunk the
// file holds, else before the nearest later one, else at the end. A wanted chunk is a pair (WantedChunk): its symbol,
// which a C definition of it is called, and its stub name, the chunk file's base name an INCLUDE_ASM statement names
// (they differ for a member of a case-folded group, `<Name>_<ADDR>`; architecture-a1-1). A stub is matched by stub
// name, a definition by symbol. A function the file defines counts as held (its stub was replaced by C). It removes
// every stub of the module's own directory (`asm/nonmatchings/<module>`) whose stub name is not wanted: a function the
// TOML renamed, deleted or moved to another module, whose file `generate` no longer writes there (D75 b; a move is
// this removal plus the insertion in the other module's file). A removed stub alone on its line takes the line with
// it; one that shares its line keeps the rest of it (and, when it is the line's last item, takes the blanks before
// it). A stub of another directory and a definition are never removed. W_C_ORDER when the file holds the wanted
// chunks in another order than ROM order; the edits never reorder. Every edit is an insertion between tokens or the
// removal of a whole statement (and its line's blanks), so no comment, string or directive changes.
//
// Preprocessor conditionals (fix round 2, correctness-a0-2; fix round 3, correctness-a1-1): a stub never goes inside
// an `#if`/`#ifdef`/`#ifndef` … `#endif` region, whose branches the default build may not compile (the decomp pattern
// `#ifdef NONMATCHING <C> #else INCLUDE_ASM(…); #endif`), and nothing inside one is ever edited. An anchor inside a
// region moves to the region's outer edge: after its `#endif` line, or before its opening directive. A stub inside a
// region holds its chunk (the `#else` branch is the default build's); a definition inside one does not, so a chunk
// whose only C is conditional gets its stub after the region. An unwanted stub inside a region is
// E_C_CONDITIONAL_STUB, an error, instead of a removal: removing it from the `#else` branch would leave the default
// build without the function's code. A name with no safe place (the text ends inside a comment, a literal, a
// directive or an unclosed conditional; fix round 4, correctness-a2-3: between two chunks one region holds, whose
// split would put the new stub after the region's later chunk) is E_C_STUB_UNPLACED, an error, so `generate` writes
// nothing rather than leave a function without its stub. The ROM order is checked again over the planned text: an
// insertion that would sit out of ROM order is E_C_STUB_UNPLACED too, never a W_C_ORDER the next run would print.
//
// A definition whose name the module does not want is E_C_STALE_DEFINITION, an error, when its name is a function
// of the tree romlift last generated that no module has now (`wanted.retired`, the chunk files on disk; fix round 3,
// correctness-a1-2, a1-3): the C of a function the TOML renamed or deleted, wherever it lies; or when it lies where
// the stub of a chunk goes whose file that tree already held in this module's directory (`wanted.priorStubs`; fix
// round 4, correctness-a2-1): the file neither includes nor defines a chunk it held before, so its INCLUDE_ASM was
// replaced by C under another name (a function renamed in C only), and inserting the stub again would build its
// bytes twice. A static helper (no function of any tree, beside no chunk the file held) raises nothing. When that
// tree is not known (the first `generate` of a clone, whose asm/ is gitignored, D79 b), a definition is stale
// wherever a missing stub goes (correctness-a0-1). The other unwanted definitions are returned (`undeclared`) for
// the caller, which knows the other modules (core/workflow/c-stubs.ts: E_C_DEFINITION_MOVED).
import { includeAsmStatement } from '../../foundation/asm/dialect.ts';
import { nonmatchingDir } from '../../foundation/util/project-files.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { tokenizeC, isTrivia } from './c-tokens.ts';
import type { CToken } from './c-tokens.ts';
import { ReconcileCodes } from './codes.ts';
import type { ReconcileCode } from './codes.ts';
import { applyTextEdits } from './text-edit.ts';
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
  /** The outermost preprocessor conditionals, in text order. */
  readonly conditionals: readonly CConditional[];
  /** Why the scanner cannot split the file (an unbalanced conditional, an unclosed or unnamed definition); empty when it can. */
  readonly unscannable: readonly CUnscannable[];
}

/** One place the scanner cannot split: its line, and why. */
export interface CUnscannable {
  readonly line: number;
  readonly reason: string;
}

/**
 * An outermost `#if`, `#ifdef` or `#ifndef` region: from its opening directive's first offset to the end of its
 * matching `#endif` (`terminated`), or to the end of the text when it is never closed.
 */
export interface CConditional {
  readonly start: number;
  readonly end: number;
  readonly terminated: boolean;
}

/** The directive name of a preprocessor line (`#  ifdef X` -> `ifdef`); '' for a null directive. */
function directiveName(text: string): string {
  let k = 1;
  while (text[k] === ' ' || text[k] === '\t') k++;
  let name = '';
  for (; k < text.length; k++) {
    const ch = text[k] ?? '';
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_')) break;
    name += ch;
  }
  return name;
}

/** The outermost conditional regions the preprocessor lines of `tokens` open and close; a stray `#endif` is ignored. */
function conditionalsOf(tokens: readonly CToken[], length: number): readonly CConditional[] {
  const out: CConditional[] = [];
  let depth = 0;
  let open: CToken | undefined;
  for (const t of tokens) {
    if (t.kind !== 'preprocessor') continue;
    const name = directiveName(t.text);
    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
      if (depth === 0) open = t;
      depth++;
    } else if (name === 'endif' && depth > 0) {
      depth--;
      if (depth === 0 && open !== undefined) {
        out.push({ start: open.start, end: t.end, terminated: true });
        open = undefined;
      }
    }
  }
  if (open !== undefined) out.push({ start: open.start, end: length, terminated: false });
  return out;
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

/** The identifiers that open a GCC attribute or asm group, `name ( … )`, which a function's head may carry. */
const GROUP_KEYWORDS: ReadonlySet<string> = new Set(['__attribute__', '__attribute', '__asm__', '__asm', 'asm']);

/** `head` without its attribute and asm groups (`__attribute__((section(".iwram")))`, `asm("name")`). */
function withoutGroups(head: readonly CToken[]): readonly CToken[] {
  const out: CToken[] = [];
  for (let i = 0; i < head.length; i++) {
    const t = head[i];
    if (t === undefined) continue;
    if (t.kind !== 'identifier' || !GROUP_KEYWORDS.has(t.text) || !isPunct(head[i + 1], '(')) {
      out.push(t);
      continue;
    }
    let depth = 0;
    for (i++; i < head.length; i++) {
      if (isPunct(head[i], '(')) depth++;
      else if (isPunct(head[i], ')') && --depth === 0) break;
    }
  }
  return out;
}

/**
 * The name of the function whose head the code tokens before a `{` at depth 0 are; '' when they are a function's head
 * whose name the scanner cannot read; undefined when they are no function's head. A head ends, once its attribute and
 * asm groups are left out, with the `)` that closes a parameter list, and holds no `=` at depth 0 (an initializer's
 * braces). Its name is the identifier before the first `(` that opens a parameter list rather than a declarator group
 * (`(*`): `f` in `int f(int a)`, `B` in `void (*B(void))(void)`, a function returning a function pointer.
 */
function definitionName(tokens: readonly CToken[]): string | undefined {
  const head = withoutGroups(tokens);
  if (!isPunct(head[head.length - 1], ')')) return undefined;
  let depth = 0;
  for (const t of head) {
    if (isPunct(t, '(') || isPunct(t, '[')) depth++;
    else if (isPunct(t, ')') || isPunct(t, ']')) depth--;
    else if (depth === 0 && isPunct(t, '=')) return undefined;
  }
  for (let i = 1; i < head.length; i++) {
    const before = head[i - 1];
    if (isPunct(head[i], '(') && before?.kind === 'identifier' && !isPunct(head[i + 1], '*')) return before.text;
  }
  return '';
}

/** An open preprocessor conditional while scanning: the depths it found, its line, and whether a branch broke them. */
interface OpenConditional {
  readonly braces: number;
  readonly parens: number;
  readonly line: number;
  broken: boolean;
}

/** What a C text holds at file scope (the module comment above says how it splits). */
export function scanC(text: string): CFileScan {
  const tokens = tokenizeC(text);
  const statements: IncludeAsmStatement[] = [];
  const definitions: CDefinition[] = [];
  const others: COther[] = [];
  const directives = tokens.filter(isTrivia);
  const unscannable: CUnscannable[] = [];
  /** The conditionals open at the current token, innermost last. */
  const open: OpenConditional[] = [];
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
  for (const t of tokens) {
    if (t.kind === 'comment') continue;
    if (t.kind === 'preprocessor') {
      // Every branch must leave the depths as its conditional found them: the scanner counts every branch.
      const name = directiveName(t.text);
      if (name === 'if' || name === 'ifdef' || name === 'ifndef') open.push({ braces, parens, line: t.line, broken: false });
      else if (name === 'elif' || name === 'else' || name === 'endif') {
        const at = open[open.length - 1];
        if (at !== undefined && !at.broken && (at.braces !== braces || at.parens !== parens)) {
          at.broken = true;
          unscannable.push({ line: at.line, reason: `a branch of the conditional on line ${at.line} ends (line ${t.line}) with other braces or parentheses open than the conditional found` });
        }
        if (name === 'endif') open.pop();
      }
      continue;
    }
    if (item.length === 0 && definition === undefined) parens = braces = 0;
    item.push(t);
    if (isPunct(t, '(') || isPunct(t, '[')) parens++;
    else if (isPunct(t, ')') || isPunct(t, ']')) parens = Math.max(0, parens - 1);
    else if (isPunct(t, '{')) {
      if (braces === 0 && parens === 0 && definition === undefined) {
        const name = definitionName(item.slice(0, -1));
        const first = item[0];
        if (name !== undefined && first !== undefined) definition = { name, first };
        if (item.length === 1) unscannable.push({ line: t.line, reason: `a block at file scope (line ${t.line}) follows no head, as in a K&R definition` });
        else if (name === '') unscannable.push({ line: first?.line ?? t.line, reason: `the function defined on line ${first?.line ?? t.line} has a head whose name the scanner cannot read` });
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
  if (definition !== undefined) {
    definitions.push({ name: definition.name, start: definition.first.start, end: text.length, line: definition.first.line });
    unscannable.push({ line: definition.first.line, reason: `the definition${definition.name === '' ? '' : ` of ${definition.name}`} on line ${definition.first.line} never closes its body` });
  } else closeOther(text.length);
  const last = tokens[tokens.length - 1];
  const unterminated = last !== undefined && !last.terminated ? [last] : [];
  unscannable.sort((a, b) => a.line - b.line);
  return { statements, definitions, others, directives, unterminated, tokens, conditionals: conditionalsOf(tokens, text.length), unscannable };
}

/**
 * The definitions the default build compiles: those with a name, outside every preprocessor conditional (a branch
 * the default build may not compile, the NONMATCHING pattern's `#ifdef`). The one rule for "the C defines it", read
 * by the planner (a definition holds its chunk) and by the DecompState of a project (core/workflow/generate.ts,
 * architecture-a2-3).
 */
export function compiledDefinitions(scan: CFileScan): readonly CDefinition[] {
  return scan.definitions.filter((d) => d.name !== '' && regionAt(scan, d.start) === undefined);
}

// ---------------------------------------------------------------------------------------------------
// Planning.

/**
 * One chunk a C file must hold: `name`, its symbol (what a C definition of it is called), and `stub`, its chunk file's
 * base name, which its INCLUDE_ASM statement names (they differ for a member of a case-folded group, `<Name>_<ADDR>`).
 * It mirrors core/model/c-unit.ts StubChunk, field for field: core/reconcile imports only foundation (architecture
 * §2), so the shape is declared on both sides of that edge, and c-stubs.ts passes one as the other.
 */
export interface WantedChunk {
  readonly name: string;
  readonly stub: string;
}

/** The chunks a C file must hold: its module, and the module's chunks in ROM order. */
export interface IncludeAsmWanted {
  readonly module: string;
  /** The module's function and orphan chunks, in ROM order (core/model/c-unit.ts stubChunks). */
  readonly chunks: readonly WantedChunk[];
  /** The file's project path, for the diagnostics (`src/<module>.c`). */
  readonly path?: string;
  /**
   * The names of the functions of the tree romlift last generated that no module has now (core/workflow/c-stubs.ts,
   * from the chunk files on disk): a definition of one is stale wherever it lies. Undefined when that tree is not
   * known; a definition is then stale wherever a missing stub goes.
   */
  readonly retired?: readonly string[];
  /**
   * The stub names of the chunk files that tree held in this module's own directory (`asm/nonmatchings/<module>`):
   * a wanted chunk among them that the file neither includes nor defines had its INCLUDE_ASM replaced, so a definition
   * where its stub goes is stale (correctness-a2-1). Read only when `retired` is given.
   */
  readonly priorStubs?: readonly string[];
}

export interface IncludeAsmPlan {
  /** Insertions and removals, in text order; apply with applyTextEdits. */
  readonly edits: readonly TextEdit[];
  /** W_C_ORDER (at most once), E_C_STUB_UNPLACED, E_C_STALE_DEFINITION, E_C_CONDITIONAL_STUB, E_C_UNSCANNABLE. */
  readonly diagnostics: readonly Diagnostic<ReconcileCode>[];
  /** Wanted stub names the planner found no safe place for (each also an E_C_STUB_UNPLACED). */
  readonly unplaced: readonly string[];
  /** Named definitions the module does not want and no E_C_STALE_DEFINITION reports, in text order. */
  readonly undeclared: readonly CDefinition[];
}

/** Where a held chunk sits: offsets of its first token and of its end. */
interface Held {
  readonly start: number;
  readonly end: number;
}

/**
 * For each wanted chunk, where the file holds it, or undefined: the first stub of `dir` that names its stub name
 * (inside a conditional too: the `#else` branch of the NONMATCHING pattern is the default build's), else the first
 * of its compiledDefinitions. A definition inside a conditional does not hold its chunk, since the default build may
 * not compile it (correctness-a1-1).
 */
function heldOf(scan: CFileScan, dir: string, chunks: readonly WantedChunk[]): readonly (Held | undefined)[] {
  const stubs = new Map<string, Held>();
  for (const s of scan.statements) if (s.dir === dir && !stubs.has(s.name)) stubs.set(s.name, { start: s.start, end: s.end });
  const defined = new Map<string, Held>();
  for (const d of compiledDefinitions(scan)) if (!defined.has(d.name)) defined.set(d.name, { start: d.start, end: d.end });
  return chunks.map((c) => stubs.get(c.stub) ?? defined.get(c.name));
}

/** The length of a leading byte order mark (U+FEFF), which no edit may move off the text's start. */
function bomLength(text: string): number {
  return text.charCodeAt(0) === 0xfeff ? 1 : 0;
}

/** The start of the line `offset` is on (never before a leading byte order mark). */
function lineStartOf(text: string, offset: number): number {
  return Math.max(text.lastIndexOf('\n', offset - 1) + 1, bomLength(text));
}

/**
 * The offset just past the line `offset` is on: past the blanks, comments (by start) and removed statements (start to
 * end) that follow it, and its newline; whether there was one.
 */
function afterLine(text: string, skips: ReadonlyMap<number, number>, offset: number): { readonly at: number; readonly newline: boolean } {
  let at = offset;
  for (;;) {
    while (text[at] === ' ' || text[at] === '\t') at++;
    const skip = skips.get(at);
    if (skip !== undefined) {
      at = skip;
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
  const lineStart = lineStartOf(text, at);
  const prev = before.filter((t) => t.end <= at).pop();
  // A token ends on this line before the item (`foo(); INCLUDE_ASM(…)`): the stub goes right before the item.
  return prev !== undefined && prev.end > lineStart ? at : lineStart;
}

/** The outermost conditional region `offset` lies in, if any. */
function regionAt(scan: CFileScan, offset: number): CConditional | undefined {
  return scan.conditionals.find((c) => c.start <= offset && offset < c.end);
}

/** For each wanted chunk, the index of the nearest held chunk before it (`earlier`) and after it (`later`) in ROM order. */
function neighbours(held: readonly (Held | undefined)[]): { readonly earlier: readonly (number | undefined)[]; readonly later: readonly (number | undefined)[] } {
  const earlier: (number | undefined)[] = [];
  const later: (number | undefined)[] = new Array<number | undefined>(held.length).fill(undefined);
  let last: number | undefined;
  held.forEach((h, k) => {
    earlier.push(last);
    if (h !== undefined) last = k;
  });
  let following: number | undefined;
  for (let k = held.length - 1; k >= 0; k--) {
    later[k] = following;
    if (held[k] !== undefined) following = k;
  }
  return { earlier, later };
}

/** One planned insertion: the wanted chunk's index, its edit, and the indices of the held chunks it was placed between. */
interface Insertion {
  readonly chunk: number;
  readonly edit: TextEdit;
  readonly earlier: number | undefined;
  readonly later: number | undefined;
}

/** Where the diagnostics of `wanted` say the file is. */
function whereOf(wanted: IncludeAsmWanted): { readonly where: string; readonly extra: { readonly path?: string } } {
  return { where: wanted.path ?? `the C file of module ${wanted.module}`, extra: wanted.path === undefined ? {} : { path: wanted.path } };
}

/** W_C_ORDER when the held wanted chunks are not in ROM order in the text (the first pair out of order). */
function orderDiagnostics(wanted: IncludeAsmWanted, held: readonly (Held | undefined)[]): Diagnostic<ReconcileCode>[] {
  const order = wanted.chunks.flatMap((chunk, k) => {
    const h = held[k];
    return h === undefined ? [] : [{ name: chunk.name, ...h }];
  });
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (prev === undefined || cur === undefined || cur.start > prev.start) continue;
    const { where, extra } = whereOf(wanted);
    return [diagnostic(ReconcileCodes, 'W_C_ORDER', `${where} holds ${cur.name} before ${prev.name}, which comes first in ROM order`, extra)];
  }
  return [];
}

/**
 * The removal of statement `s`: its whole line (from the line's start through its newline) when nothing else is on
 * it; the statement and the blanks around it up to the newline when it is the last item of a shared line; else the
 * statement alone.
 */
function removalOf(text: string, s: IncludeAsmStatement): TextEdit {
  const lineStart = lineStartOf(text, s.start);
  let after = s.end;
  while (text[after] === ' ' || text[after] === '\t') after++;
  const lineEnd = text[after] === '\n' ? after + 1 : text[after] === '\r' && text[after + 1] === '\n' ? after + 2 : after === text.length ? after : -1;
  if (lineEnd >= 0 && text.slice(lineStart, s.start).trim() === '') return { start: lineStart, end: lineEnd, text: '', reason: 'remove-stub' };
  if (lineEnd >= 0) {
    let from = s.start;
    while (from > lineStart && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
    return { start: from, end: after, text: '', reason: 'remove-stub' };
  }
  return { start: s.start, end: s.end, text: '', reason: 'remove-stub' };
}

/**
 * Where a missing stub goes: an insertion, or undefined when it has no safe place. After a held chunk inside a
 * region, the place is after the region's `#endif`, which is no place when the chunk held after it lies in that
 * region too (a split of the region's first chunk: the stub would land behind the later one, correctness-a2-3).
 */
function placement(text: string, scan: CFileScan, skips: ReadonlyMap<number, number>, stub: string, before: Held | undefined, after: Held | undefined): TextEdit | undefined {
  if (before !== undefined) {
    const region = regionAt(scan, before.start);
    if (region !== undefined && (!region.terminated || (after !== undefined && after.start < region.end))) return undefined;
    const line = afterLine(text, skips, region?.end ?? before.end);
    return { start: line.at, end: line.at, text: line.newline ? `${stub}\n` : `\n${stub}\n`, reason: 'add-stub' };
  }
  if (after !== undefined) {
    const at = beforeItem(text, scan, regionAt(scan, after.start)?.start ?? after.start);
    return { start: at, end: at, text: `${stub}\n`, reason: 'add-stub' };
  }
  if (scan.unterminated.length > 0 || scan.conditionals.some((c) => !c.terminated)) return undefined;
  const needsNewline = text.length > bomLength(text) && !text.endsWith('\n');
  return { start: text.length, end: text.length, text: `${needsNewline ? '\n' : ''}${stub}\n`, reason: 'add-stub' };
}

/**
 * The E_C_STALE_DEFINITION of definition `d`; `slot`: the missing chunk whose stub goes where it lies, if any;
 * `replaced`: when the previous tree is known and d is not one of its functions, the chunk of that tree's own
 * directory whose stub d took the place of.
 */
function staleDiagnostic(wanted: IncludeAsmWanted, d: CDefinition, slot: WantedChunk | undefined, replaced: WantedChunk | undefined): Diagnostic<ReconcileCode> {
  const { where, extra } = whereOf(wanted);
  const dir = nonmatchingDir(wanted.module);
  if (replaced !== undefined) {
    return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name} (line ${d.line}) where the INCLUDE_ASM of ${replaced.stub} was, and module ${wanted.module} still has ${replaced.name}, which the file now neither includes nor defines: if you renamed ${replaced.name} in C, rename it in romlift.toml too (or the C back to ${replaced.name}); otherwise restore INCLUDE_ASM("${dir}", ${replaced.stub}); else make builds its bytes twice`, extra);
  }
  if (wanted.retired === undefined) {
    // The tree romlift last generated is not known, so d may be the user's helper.
    const stub = slot?.stub ?? '';
    return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name} (line ${d.line}), which module ${wanted.module} no longer has, where the INCLUDE_ASM of ${stub} goes: if romlift.toml renamed it, rename the C function to ${slot?.name ?? ''}; otherwise write INCLUDE_ASM("${dir}", ${stub}); yourself`, extra);
  }
  const here = slot === undefined ? '' : `; the INCLUDE_ASM of ${slot.stub} goes where it lies: if romlift.toml renamed it to ${slot.name}, rename the C function to ${slot.name}`;
  return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name} (line ${d.line}), a function of the tree romlift last generated that romlift.toml no longer has${here}; a function it renamed takes its new name, in the source of the module that holds it now, and one it deleted loses its C, else make builds its bytes twice`, extra);
}

/**
 * The edits that add the stub of every wanted chunk `text` neither includes (from `asm/nonmatchings/<module>`) nor
 * defines outside a conditional, each at its ROM-order position outside any preprocessor conditional, and remove every
 * stub of that directory whose chunk is not wanted and that lies outside every conditional; W_C_ORDER when the file's
 * order of the held ones is not ROM order; E_C_STUB_UNPLACED for a chunk with no safe place; E_C_CONDITIONAL_STUB for an
 * unwanted stub inside a conditional, which is never edited; E_C_STALE_DEFINITION for an unwanted definition of a
 * function of the previous tree (`wanted.retired`), or one where the stub goes of a chunk whose file that tree held in
 * the module's directory (`wanted.priorStubs`); when that tree is not known, one where a missing stub goes;
 * E_C_UNSCANNABLE, and no edit, for a file the scanner cannot split.
 */
export function planIncludeAsm(text: string, wanted: IncludeAsmWanted): IncludeAsmPlan {
  const scan = scanC(text);
  if (scan.unscannable.length > 0) return unscannablePlan(wanted, scan.unscannable);
  const dir = nonmatchingDir(wanted.module);
  const held = heldOf(scan, dir, wanted.chunks);
  const { earlier, later } = neighbours(held);
  const stubs = new Set(wanted.chunks.map((c) => c.stub));
  const symbols = new Set(wanted.chunks.map((c) => c.name));
  const unwanted = scan.statements.filter((s) => s.dir === dir && !stubs.has(s.name));
  const conditional = unwanted.filter((s) => regionAt(scan, s.start) !== undefined);
  const removed = unwanted.filter((s) => regionAt(scan, s.start) === undefined);
  const skips = new Map<number, number>([
    ...scan.directives.filter((t) => t.kind === 'comment' && t.terminated).map((t) => [t.start, t.end] as const),
    ...removed.map((s) => [s.start, s.end] as const),
  ]);
  const strangers = scan.definitions.filter((d) => d.name !== '' && !symbols.has(d.name));
  const retired = wanted.retired === undefined ? undefined : new Set(wanted.retired);
  const priorStubs = new Set(wanted.priorStubs ?? []);
  /** Each stranger's slots: the missing chunks whose stubs go where it lies, in ROM order. */
  const slots = new Map<CDefinition, WantedChunk[]>();
  const insertions: Insertion[] = [];
  /** The stubs with no safe place, by why: the text's end or a region (placement), or ROM order (the planned text). */
  const unplaced: string[] = [];
  const misordered: string[] = [];
  wanted.chunks.forEach((chunk, k) => {
    if (held[k] !== undefined) return;
    const e = earlier[k];
    const l = later[k];
    const before = e === undefined ? undefined : held[e];
    const after = l === undefined ? undefined : held[l];
    const from = before?.end ?? 0;
    const to = after?.start ?? text.length;
    for (const d of strangers) if (d.start >= from && d.end <= to) slots.set(d, [...(slots.get(d) ?? []), chunk]);
    const edit = placement(text, scan, skips, includeAsmStatement(wanted.module, chunk.stub), before, after);
    if (edit === undefined) unplaced.push(chunk.stub);
    else insertions.push({ chunk: k, edit, earlier: e, later: l });
  });
  // The planned text in ROM order: an insertion that lands out of it has no safe place either (correctness-a2-3).
  for (const k of misplacedInsertions(text, dir, wanted.chunks, held, insertions, removed.map((s) => removalOf(text, s)))) {
    const chunk = wanted.chunks[k];
    if (chunk !== undefined) misordered.push(chunk.stub);
  }
  const edits: TextEdit[] = insertions.filter((i) => !misordered.includes(wanted.chunks[i.chunk]?.stub ?? '')).map((i) => i.edit);
  for (const statement of removed) edits.push(removalOf(text, statement));
  /** The chunk of the previous tree's own directory a stranger took the place of (correctness-a2-1). */
  const replacedOf = (d: CDefinition): WantedChunk | undefined => (retired === undefined || retired.has(d.name) ? undefined : slots.get(d)?.find((c) => priorStubs.has(c.stub)));
  const stale = strangers.filter((d) => (retired === undefined ? slots.has(d) : retired.has(d.name) || replacedOf(d) !== undefined));
  const { where, extra } = whereOf(wanted);
  const diagnostics: Diagnostic<ReconcileCode>[] = [...orderDiagnostics(wanted, held)];
  if (unplaced.length > 0) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} has no safe place for the INCLUDE_ASM of ${unplaced.join(', ')}: the text ends inside a comment, a literal, a directive or an unclosed #if, or the stub would go between two chunks one #if region holds; close it, or write the statements yourself (in each branch of the region)`, extra));
  }
  if (misordered.length > 0) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} has no safe place for the INCLUDE_ASM of ${misordered.join(', ')}: inserted where the file's other chunks allow, it would be out of ROM order (the make would place its bytes elsewhere); write the statements yourself, in ROM order`, extra));
  }
  for (const s of conditional) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_CONDITIONAL_STUB', `${where} holds INCLUDE_ASM("${s.dir}", ${s.name}); (line ${s.line}) inside an #if region, and module ${wanted.module} no longer has ${s.name}: romlift never edits conditional code, so rename or remove it there yourself (and the C beside it)`, extra));
  }
  for (const d of stale) diagnostics.push(staleDiagnostic(wanted, d, slots.get(d)?.[0], replacedOf(d)));
  const isStale = new Set(stale);
  return { edits: joinAtOffsets(edits), diagnostics, unplaced: [...unplaced, ...misordered], undeclared: strangers.filter((d) => !isStale.has(d)) };
}

/** The refusal of a file the scanner cannot split: E_C_UNSCANNABLE, and no edit. */
function unscannablePlan(wanted: IncludeAsmWanted, why: readonly CUnscannable[]): IncludeAsmPlan {
  const { where, extra } = whereOf(wanted);
  const message = `${where} cannot be scanned for its INCLUDE_ASM lines: ${why.map((u) => u.reason).join('; ')}; romlift edits nothing in it: balance each branch of the conditional (or move it inside the function), or close the definition`;
  return { edits: [], diagnostics: [diagnostic(ReconcileCodes, 'E_C_UNSCANNABLE', message, extra)], unplaced: [], undeclared: [] };
}

/**
 * The wanted chunks (indices) whose insertion puts them out of ROM order in the planned text (the text with every
 * insertion and removal applied, scanned again): one that lands before the held chunk it was placed after, or after
 * the one it was placed before, when the file held those two in ROM order (an order the file already breaks is
 * W_C_ORDER's, and the edits never reorder).
 */
function misplacedInsertions(text: string, dir: string, chunks: readonly WantedChunk[], held: readonly (Held | undefined)[], insertions: readonly Insertion[], removals: readonly TextEdit[]): readonly number[] {
  if (insertions.length === 0) return [];
  const planned = heldOf(scanC(applyTextEdits(text, joinAtOffsets([...insertions.map((i) => i.edit), ...removals]))), dir, chunks);
  const at = (k: number | undefined): number | undefined => (k === undefined ? undefined : planned[k]?.start);
  const out: number[] = [];
  for (const i of insertions) {
    const e = i.earlier === undefined ? undefined : held[i.earlier];
    const l = i.later === undefined ? undefined : held[i.later];
    if (e !== undefined && l !== undefined && e.start > l.start) continue;
    const self = at(i.chunk);
    const before = at(i.earlier);
    const after = at(i.later);
    if (self === undefined || (before !== undefined && self < before) || (after !== undefined && self > after)) out.push(i.chunk);
  }
  return out;
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
