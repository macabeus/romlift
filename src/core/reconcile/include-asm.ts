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
// The scanner reads a preprocessor conditional as the preprocessor would (fix round 5, correctness-b0-1): each branch
// from the state its `#if` found, the first branch's state standing after the `#endif`, the items of every branch kept.
// So a branch inside a body may open a block the other does not (`#ifndef NONMATCHING do { #endif … #ifndef
// NONMATCHING } while (0); #endif`, or `#if V1 if (a) { #else if (b) { #endif`). A file the scanner cannot split is
// unscannable (fix round 4, correctness-a2-2, a2-6): the branches of a conditional at file scope that end with other
// depths, another open definition or another unfinished head than each other (`ASM_FUNC("…", void f(void))` with no
// `;` against a definition), a branch inside a body that closes the body, a definition whose `{` never closes, and a
// `{` at file scope after a head that names no function (a K&R definition, a head the scanner cannot read).
// planIncludeAsm then edits nothing: E_C_UNSCANNABLE, an error, so `generate` writes nothing, when the file needs an
// edit; W_C_UNSCANNABLE, a warning, when what the scanner read needs none.
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
// it). A stub of another directory is removed only when `wanted.tree` writes no such file (fix round 5,
// correctness-b0-2: a renamed `c` module's source moved by hand keeps the old directory's stubs); a definition never is. W_C_ORDER when the file holds the wanted
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
// nothing rather than leave a function without its stub. (Fix round 4 also scanned the planned text again for an
// insertion out of ROM order; no layout reaches it, since every insertion lands between the held chunks it was placed
// between, and fix round 6 removed it, architecture-b1-4.) A definition in every branch of a conditional with an
// `#else` (pret's `#ifdef NONMATCHING <C> #else NAKED <asm> #endif`) is compiled in every build and holds its chunk
// (fix round 6, correctness-b1-4).
//
// Fix round 6 (correctness-b1-2, b1-3, b1-5): a file that gains a stub and has neither an INCLUDE_ASM statement nor
// `#include "include_asm.h"` gains that include too (C_STUB_HEADER), above its first line of code: the file a user
// writes with only the C E_C_DEFINITION_MOVED sent there. A src/*.c fragment the file `#include`s at file scope
// (IncludeAsmWanted.fragments) defines its functions there, at the `#include` line; a quoted include of a file romlift
// does not read that is no `.h` refuses every insertion (E_C_STUB_UNPLACED), since the fragment may define the
// function. An insertion takes the file's line terminator (`\r\n` in a CRLF file).
//
// A definition whose name the module does not want is E_C_STALE_DEFINITION, an error, when its name is a function
// of the tree romlift last generated that no module has now (`wanted.retired`, the chunk files on disk; fix round 3,
// correctness-a1-2, a1-3): the C of a function the TOML renamed or deleted, wherever it lies; or when it lies where
// the stub of a chunk goes whose file that tree already held in this module's directory (`wanted.previousStubs`; fix
// round 4, correctness-a2-1): the file neither includes nor defines a chunk it held before, so its INCLUDE_ASM was
// replaced by C under another name (a function renamed in C only), and inserting the stub again would build its
// bytes twice. A static helper (no function of any tree, beside no chunk the file held) raises nothing. When that
// tree is not known (the first `generate` of a clone, whose asm/ is gitignored, D79 b), a definition is stale
// wherever a missing stub goes (correctness-a0-1). The other unwanted definitions are returned (`undeclared`) for
// the caller, which knows the other modules (core/workflow/c-stubs.ts: E_C_DEFINITION_MOVED).
import { C_STUB_HEADER, includeAsmStatement } from '../../foundation/asm/dialect.ts';
import { chunkFileOf, INCLUDE_ASM_HEADER_NAME, nonmatchingDir, NONMATCHINGS_ROOT } from '../../foundation/util/project-files.ts';
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
  /**
   * The project path of the src/*.c fragment that defines it, when the file only #includes it (fix round 6,
   * correctness-b1-3): its offsets and line are then those of the `#include` line.
   */
  readonly via?: string;
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
  /**
   * Its branches in text order (fix round 6, correctness-b1-4): each from the end of the directive that opens it to the
   * start of the next `#elif`, `#else` or `#endif` of the region's own depth.
   */
  readonly branches: readonly COffsets[];
  /** Whether it has an `#else`, so that one of its branches is compiled in every build. */
  readonly hasElse: boolean;
  /** The conditionals nested inside it, at any depth: from each one's opening directive to its `#endif`. */
  readonly nested: readonly COffsets[];
}

/** A range of offsets of a C text. */
export interface COffsets {
  readonly start: number;
  readonly end: number;
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

/**
 * The outermost conditional regions the preprocessor lines of `tokens` open and close, with their branches and the
 * conditionals nested in them; a stray `#endif` is ignored.
 */
function conditionalsOf(tokens: readonly CToken[], length: number): readonly CConditional[] {
  const out: CConditional[] = [];
  let depth = 0;
  let open: { readonly start: number; branchStart: number; readonly branches: COffsets[]; hasElse: boolean; readonly nested: COffsets[] } | undefined;
  /** The opening offsets of the nested conditionals open now, innermost last. */
  const inner: number[] = [];
  for (const t of tokens) {
    if (t.kind !== 'preprocessor') continue;
    const name = directiveName(t.text);
    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
      if (depth === 0) open = { start: t.start, branchStart: t.end, branches: [], hasElse: false, nested: [] };
      else inner.push(t.start);
      depth++;
    } else if ((name === 'elif' || name === 'else') && depth === 1 && open !== undefined) {
      open.branches.push({ start: open.branchStart, end: t.start });
      open.branchStart = t.end;
      if (name === 'else') open.hasElse = true;
    } else if (name === 'endif' && depth > 0) {
      depth--;
      if (depth > 0) {
        const start = inner.pop();
        if (start !== undefined) open?.nested.push({ start, end: t.end });
      } else if (open !== undefined) {
        open.branches.push({ start: open.branchStart, end: t.start });
        out.push({ start: open.start, end: t.end, terminated: true, branches: open.branches, hasElse: open.hasElse, nested: open.nested });
        open = undefined;
      }
    }
  }
  if (open !== undefined) {
    open.branches.push({ start: open.branchStart, end: length });
    out.push({ start: open.start, end: length, terminated: false, branches: open.branches, hasElse: open.hasElse, nested: open.nested });
  }
  return out;
}

/** The quoted path of an `#include "…"` line, or undefined for any other line (an `<…>` include among them). */
function quotedInclude(text: string): string | undefined {
  if (directiveName(text) !== 'include') return undefined;
  const open = text.indexOf('"');
  const close = open < 0 ? -1 : text.indexOf('"', open + 1);
  const before = open < 0 ? '' : text.slice(text.indexOf('include') + 'include'.length, open);
  return close < 0 || before.trim() !== '' ? undefined : text.slice(open + 1, close);
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

/** The scanner's state between tokens: the current item, its depths, and the definition it is the body of. */
interface ScanState {
  readonly item: readonly CToken[];
  readonly parens: number;
  readonly braces: number;
  readonly definition: { readonly name: string; readonly first: CToken } | undefined;
}

/**
 * An open preprocessor conditional while scanning: the state its `#if` found (`opened`), its line, whether it opened
 * inside a definition's body (`inside`) and whether a branch closed that body (`broken`), whether it has an `#else`
 * branch or an `#elif` alternative yet (`sawElse`), and the state each finished branch ended in (`ends`).
 */
interface OpenConditional {
  readonly opened: ScanState;
  readonly line: number;
  readonly inside: boolean;
  broken: boolean;
  sawElse: boolean;
  readonly ends: ScanState[];
}

/**
 * Whether two scanner states split what follows alike: the same depths, the same open definition, and both with or
 * without a parenthesis group in an unfinished item at file scope (which would name the next definition's head: a
 * macro call with no `;` before it, `ASM_FUNC("…", void f(void))`; a bare `END_NONMATCH` names nothing, and inside an
 * initializer's braces no head is read).
 */
function sameShape(a: ScanState, b: ScanState): boolean {
  const group = (s: ScanState): boolean => s.braces === 0 && s.definition === undefined && s.item.some((t) => isPunct(t, '('));
  return a.braces === b.braces && a.parens === b.parens && a.definition?.name === b.definition?.name && group(a) === group(b);
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
      // As the preprocessor reads a conditional (fix round 5, correctness-b0-1): each branch starts from the state
      // its #if found, and the state the first branch reached stands after the #endif (the `#ifndef NONMATCHING do {`
      // … `#ifndef NONMATCHING } while (0);` idiom reads as one consistent build). The items a branch completes are
      // kept, whichever branch (the NONMATCHING pattern's #else stub holds its chunk).
      const name = directiveName(t.text);
      const state = (): ScanState => ({ item: [...item], parens, braces, definition });
      const restore = (to: ScanState): void => {
        item = [...to.item];
        ({ parens, braces, definition } = to);
      };
      if (name === 'if' || name === 'ifdef' || name === 'ifndef') open.push({ opened: state(), line: t.line, inside: definition !== undefined, broken: false, sawElse: false, ends: [] });
      else if (name === 'elif' || name === 'else' || name === 'endif') {
        const at = open[open.length - 1];
        if (at !== undefined) {
          at.ends.push(state());
          if (name === 'else' || name === 'elif') at.sawElse = true;
          if (name !== 'endif') restore(at.opened);
          else {
            // The #if's own state is the end of its implicit empty #else; a chain of #elif alternatives
            // (`#if (GAME == SA1) head #elif (GAME == SA2) head #endif`) is read as covering every build.
            const ends = at.sawElse ? at.ends : [...at.ends, at.opened];
            const first = ends[0] ?? at.opened;
            if (!at.inside && !ends.every((e) => sameShape(e, first))) {
              // At file scope the branches must agree: which one's items continue after the #endif decides what
              // the next definition is called.
              unscannable.push({ line: at.line, reason: `the branches of the conditional on line ${at.line} end (line ${t.line}) with other braces, parentheses or an unfinished head open than each other` });
            }
            restore(first);
            // A bare unfinished item the region leaves at file scope (`END_NONMATCH`, a `static` alone) names no
            // head: it ends with the region, so the next definition starts at its own head, outside the region.
            if (!at.inside && definition === undefined && braces === 0 && parens === 0 && item.length > 0 && !item.some((k) => isPunct(k, '('))) closeOther(t.end);
          }
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
      const closing = braces === 0 && definition !== undefined ? open.find((c) => c.inside && !c.broken) : undefined;
      if (closing !== undefined) {
        // A branch of a conditional opened inside a body closes that body: the items after it differ by branch.
        closing.broken = true;
        unscannable.push({ line: closing.line, reason: `a branch of the conditional on line ${closing.line}, inside a definition, closes that definition (line ${t.line})` });
      }
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
 * Whether item `d` lies wholly inside one preprocessor conditional, a branch the default build may not compile (the
 * NONMATCHING pattern's `#ifdef`). A definition whose head a conditional holds but whose body runs past its `#endif`
 * (`#ifndef NON_MATCHING <head> { <register pin> #else <head> { #endif <body> }`) is compiled in every build.
 */
function insideRegion(scan: CFileScan, d: COffsets): boolean {
  const region = regionAt(scan, d.start);
  return region !== undefined && d.end <= region.end;
}

/**
 * Whether definition `d`, wholly inside `region`, is compiled in every build all the same (fix round 6,
 * correctness-b1-4): the region has an `#else` and every branch defines d's name outside the conditionals nested in
 * it, as pret's `#ifdef NONMATCHING <C> #else NAKED <asm> #endif` does. Only the first branch's definition counts,
 * so a name has one compiled definition.
 */
function inEveryBranch(scan: CFileScan, region: CConditional, d: CDefinition): boolean {
  if (!region.terminated || !region.hasElse) return false;
  const holds = (branch: COffsets, e: CDefinition): boolean => e.start >= branch.start && e.end <= branch.end && !region.nested.some((n) => e.start >= n.start && e.start < n.end);
  const [first, ...others] = region.branches;
  return first !== undefined && holds(first, d) && others.every((branch) => scan.definitions.some((e) => e.name === d.name && holds(branch, e)));
}

/** The named definitions of `scan` the default build compiles: outside every region (insideRegion), or in every branch of one (inEveryBranch). */
function compiledOf(scan: CFileScan): readonly CDefinition[] {
  return scan.definitions.filter((d) => {
    if (d.name === '') return false;
    const region = regionAt(scan, d.start);
    return region === undefined || d.end > region.end || inEveryBranch(scan, region, d);
  });
}

/**
 * What a C file defines for the default build: its named definitions outside every conditional that holds them whole
 * (insideRegion), or in every branch of one that has an `#else` (inEveryBranch). `scannable: false` when the scanner cannot split the file (`unscannable` says why); the
 * definitions are then only what it read, which may miss or misname some, and each caller states what it does with
 * them (fix round 5, architecture-b0-2).
 */
export type CompiledDefinitions =
  | { readonly scannable: true; readonly definitions: readonly CDefinition[] }
  | { readonly scannable: false; readonly definitions: readonly CDefinition[]; readonly unscannable: readonly CUnscannable[] };

/**
 * The one rule for "the C defines it" (architecture-a2-3, fix round 5 architecture-b0-2), the scanner's precondition
 * included: read by the planner (a definition holds its chunk: heldOf, and unscannablePlan for a file the scanner
 * cannot split), by the C files of no module and the fragments a module's file includes (c-stubs.ts), and by the
 * DecompState of a project (core/workflow/generate.ts).
 */
export function compiledDefinitions(scan: CFileScan): CompiledDefinitions {
  const definitions = compiledOf(scan);
  return scan.unscannable.length === 0 ? { scannable: true, definitions } : { scannable: false, definitions, unscannable: scan.unscannable };
}

/**
 * Every `INCLUDE_ASM("<dir>", <name>);` the tokens of `scan` spell, at any depth: a file the scanner cannot split
 * still shows every stub it names (planIncludeAsm's check that such a file needs no edit).
 */
function anyDepthStatements(scan: CFileScan): readonly IncludeAsmStatement[] {
  const code = scan.tokens.filter((t) => !isTrivia(t));
  const out: IncludeAsmStatement[] = [];
  code.forEach((t, i) => {
    if (t.kind !== 'identifier' || t.text !== INCLUDE_ASM_MACRO) return;
    const statement = statementOf(code.slice(i, i + 7));
    if (statement !== undefined) out.push(statement);
  });
  return out;
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
  readonly previousStubs?: readonly string[];
  /**
   * The tree this run writes (fix round 5, correctness-b0-2): every chunk file of it (`files`, chunkFileOf paths), and
   * the nonmatchings directories of the modules it never writes (`userDirs`, a module with `generated = false`). A stub
   * of another directory under `asm/nonmatchings/` that names no file of the tree, outside `userDirs` (its module was
   * renamed or deleted, or no longer has that chunk), is unwanted like one of the module's own. Undefined: such stubs
   * are left alone.
   */
  readonly tree?: StubTree;
  /**
   * The compiled definitions (names, in text order) of each src/*.c that is no module's source, by project path (fix
   * round 6, correctness-b1-3): a file this one `#include`s at file scope (`#include "poly.inc.c"`, resolved from
   * `path`'s directory) defines them here, at its `#include` line. A quoted include of no file listed here whose path
   * does not end in `.h` is a fragment romlift does not read: a stub this file would gain is then E_C_STUB_UNPLACED,
   * since the fragment may define it. Undefined (or `path` undefined): includes are not followed.
   */
  readonly fragments?: ReadonlyMap<string, readonly string[]>;
}

/** The chunk files a run writes, and the directories it leaves to the user (IncludeAsmWanted.tree). */
export interface StubTree {
  readonly files: ReadonlySet<string>;
  readonly userDirs: ReadonlySet<string>;
}

export interface IncludeAsmPlan {
  /** Insertions and removals, in text order; apply with applyTextEdits. */
  readonly edits: readonly TextEdit[];
  /** W_C_ORDER (at most once), E_C_STUB_UNPLACED, E_C_STALE_DEFINITION, E_C_CONDITIONAL_STUB, E_C_UNSCANNABLE, W_C_UNSCANNABLE. */
  readonly diagnostics: readonly Diagnostic<ReconcileCode>[];
  /** Wanted stub names the planner found no safe place for (each also an E_C_STUB_UNPLACED). */
  readonly unplaced: readonly string[];
  /** Named definitions the module does not want and no E_C_STALE_DEFINITION reports, in text order. */
  readonly undeclared: readonly CDefinition[];
  /** The project paths of the fragments (IncludeAsmWanted.fragments) the file includes at file scope, in text order. */
  readonly included: readonly string[];
}

/** Where a held chunk sits: offsets of its first token and of its end. */
interface Held {
  readonly start: number;
  readonly end: number;
}

/**
 * For each wanted chunk, where the file holds it, or undefined: the first stub of `dir` that names its stub name
 * (inside a conditional too: the `#else` branch of the NONMATCHING pattern is the default build's), else the first
 * of its compiled definitions (compiledDefinitions: a definition inside a conditional does not hold its chunk, since
 * the default build may not compile it, correctness-a1-1, unless every branch of one with an `#else` defines it).
 */
function heldOf(scan: CFileScan, dir: string, chunks: readonly WantedChunk[]): readonly (Held | undefined)[] {
  const stubs = new Map<string, Held>();
  for (const s of scan.statements) if (s.dir === dir && !stubs.has(s.name)) stubs.set(s.name, { start: s.start, end: s.end });
  const defined = new Map<string, Held>();
  for (const d of compiledDefinitions(scan).definitions) if (!defined.has(d.name)) defined.set(d.name, { start: d.start, end: d.end });
  return chunks.map((c) => stubs.get(c.stub) ?? defined.get(c.name));
}

/** The line terminator of `text`: `\r\n` when its first newline follows a carriage return, else `\n` (correctness-b1-5). */
function eolOf(text: string): string {
  const newline = text.indexOf('\n');
  return newline > 0 && text[newline - 1] === '\r' ? '\r\n' : '\n';
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
  const eol = eolOf(text);
  if (before !== undefined) {
    // A definition whose body runs past the region that holds its head ends outside it (insideRegion).
    const region = insideRegion(scan, before) ? regionAt(scan, before.start) : undefined;
    if (region !== undefined && (!region.terminated || (after !== undefined && after.start < region.end))) return undefined;
    const line = afterLine(text, skips, region?.end ?? before.end);
    return { start: line.at, end: line.at, text: line.newline ? `${stub}${eol}` : `${eol}${stub}${eol}`, reason: 'add-stub' };
  }
  if (after !== undefined) {
    const at = beforeItem(text, scan, regionAt(scan, after.start)?.start ?? after.start);
    return { start: at, end: at, text: `${stub}${eol}`, reason: 'add-stub' };
  }
  if (scan.unterminated.length > 0 || scan.conditionals.some((c) => !c.terminated)) return undefined;
  const needsNewline = text.length > bomLength(text) && !text.endsWith('\n');
  return { start: text.length, end: text.length, text: `${needsNewline ? eol : ''}${stub}${eol}`, reason: 'add-stub' };
}

/**
 * The insertion of the header that defines INCLUDE_ASM (C_STUB_HEADER, in the text's line terminator), or undefined
 * when the file needs none (fix round 6, correctness-b1-2): a file that gains a stub needs it unless it already
 * includes the header or holds an INCLUDE_ASM statement anywhere (whose macro its build then defines some other way,
 * a `global.h` that includes it). It goes above the first line that is not a comment, after a leading byte order mark
 * and the comments that open the file (a licence, a file comment): a file the user wrote with only the C of a
 * function E_C_DEFINITION_MOVED sent there.
 */
function headerInsertion(text: string, scan: CFileScan): TextEdit | undefined {
  if (anyDepthStatements(scan).length > 0) return undefined;
  if (scan.directives.some((t) => t.kind === 'preprocessor' && quotedInclude(t.text) === INCLUDE_ASM_HEADER_NAME)) return undefined;
  const eol = eolOf(text);
  const header = C_STUB_HEADER.split('\n').join(eol);
  const first = scan.tokens.find((t) => t.kind !== 'comment');
  if (first === undefined) {
    const needsNewline = text.length > bomLength(text) && !text.endsWith('\n');
    return { start: text.length, end: text.length, text: `${needsNewline ? eol : ''}${header}`, reason: 'add-stub' };
  }
  // A comment that ends on the first code line (`/* … */ int x;`, or a block comment opened above it) keeps it whole.
  const lineStart = lineStartOf(text, first.start);
  const at = scan.tokens.some((t) => t.kind === 'comment' && t.start < first.start && t.end > lineStart) ? first.start : lineStart;
  return { start: at, end: at, text: at === lineStart ? header : `${eol}${header}`, reason: 'add-stub' };
}

/**
 * The E_C_STALE_DEFINITION of definition `d`; `slot`: the missing chunk whose stub goes where it lies, if any;
 * `replaced`: when the previous tree is known and d is not one of its functions, the chunk of that tree's own
 * directory whose stub d took the place of.
 */
function staleDiagnostic(wanted: IncludeAsmWanted, d: CDefinition, slot: WantedChunk | undefined, replaced: WantedChunk | undefined): Diagnostic<ReconcileCode> {
  const { where: file, extra } = whereOf(wanted);
  // A definition of an included fragment: the file the user edits is the fragment (correctness-b1-3).
  const where = d.via === undefined ? file : `${file}, through its #include of ${d.via},`;
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
 * defines for the default build, each at its ROM-order position outside any preprocessor conditional, and remove every
 * stub of that directory whose chunk is not wanted and that lies outside every conditional; W_C_ORDER when the file's
 * order of the held ones is not ROM order; E_C_STUB_UNPLACED for a chunk with no safe place; E_C_CONDITIONAL_STUB for an
 * unwanted stub inside a conditional, which is never edited; E_C_STALE_DEFINITION for an unwanted definition of a
 * function of the previous tree (`wanted.retired`), or one where the stub goes of a chunk whose file that tree held in
 * the module's directory (`wanted.previousStubs`); when that tree is not known, one where a missing stub goes. A stub
 * of another nonmatchings directory that names no file of `wanted.tree` is unwanted too (a renamed or deleted module's,
 * after its source was moved: fix round 5, correctness-b0-2). A file the scanner cannot split gets no edit: when what
 * it read of it needs one, or names a stub at any depth that would go, E_C_UNSCANNABLE (an error); otherwise
 * W_C_UNSCANNABLE, a warning, since the build it had still holds (fix round 5, correctness-b0-1). Fix round 6: the
 * definitions of a src/*.c fragment the file includes count as its own, at the `#include` line (`wanted.fragments`,
 * correctness-b1-3); a file that gains a stub gains the header that defines INCLUDE_ASM when it has none
 * (correctness-b1-2); an insertion takes the file's line terminator (correctness-b1-5).
 */
export function planIncludeAsm(text: string, wanted: IncludeAsmWanted): IncludeAsmPlan {
  const own = scanC(text);
  const { scan, included, unread } = withFragments(own, wanted);
  const plan = planScanned(text, scan, wanted, unread);
  return { ...(own.unscannable.length === 0 ? plan : unscannablePlan(scan, wanted, plan)), included };
}

/** An `#include "…"` at file scope of a file romlift does not read (a fragment that may define functions). */
interface UnreadInclude {
  readonly spelled: string;
  readonly line: number;
}

/** `path` of an `#include "<spelled>"` in the file at project path `from`, resolved from its directory; undefined above the root. */
function resolveInclude(from: string, spelled: string): string | undefined {
  const parts = from.split('/').slice(0, -1);
  for (const segment of spelled.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (parts.pop() === undefined) return undefined;
  }
  return parts.join('/');
}

/**
 * `scan` with the definitions of the fragments the file includes at file scope (outside every item: an include inside
 * an initializer or a body defines no function of its own) added at their `#include` lines (`via` names the fragment),
 * the fragments included, and the quoted includes of files romlift does not read that are no header (`.h`).
 */
function withFragments(scan: CFileScan, wanted: IncludeAsmWanted): { readonly scan: CFileScan; readonly included: readonly string[]; readonly unread: readonly UnreadInclude[] } {
  const { fragments, path } = wanted;
  if (fragments === undefined || path === undefined) return { scan, included: [], unread: [] };
  const items: readonly COffsets[] = [...scan.statements, ...scan.definitions, ...scan.others];
  const added: CDefinition[] = [];
  const included: string[] = [];
  const unread: UnreadInclude[] = [];
  for (const t of scan.directives) {
    const spelled = t.kind === 'preprocessor' ? quotedInclude(t.text) : undefined;
    if (spelled === undefined || items.some((i) => t.start >= i.start && t.start < i.end)) continue;
    const resolved = resolveInclude(path, spelled);
    const names = resolved === undefined ? undefined : fragments.get(resolved);
    if (resolved !== undefined && names !== undefined) {
      if (!included.includes(resolved)) included.push(resolved);
      for (const name of names) added.push({ name, start: t.start, end: t.end, line: t.line, via: resolved });
    } else if (!spelled.endsWith('.h')) unread.push({ spelled, line: t.line });
  }
  if (added.length === 0) return { scan, included, unread };
  const definitions = [...scan.definitions, ...added].sort((a, b) => a.start - b.start);
  return { scan: { ...scan, definitions }, included, unread };
}

/** Whether stub `s` is one the module's file must lose: of its own directory and unwanted, or of a directory the tree no longer writes it in. */
function unwantedStub(s: IncludeAsmStatement, dir: string, stubs: ReadonlySet<string>, tree: StubTree | undefined): boolean {
  if (s.dir === dir) return !stubs.has(s.name);
  if (tree === undefined || !s.dir.startsWith(`${NONMATCHINGS_ROOT}/`) || tree.userDirs.has(s.dir)) return false;
  return !tree.files.has(chunkFileOf(s.dir, s.name));
}

/** planIncludeAsm over a scan, as if it could split the text; `unread`: the fragments it includes that romlift does not read. */
function planScanned(text: string, scan: CFileScan, wanted: IncludeAsmWanted, unread: readonly UnreadInclude[]): Omit<IncludeAsmPlan, 'included'> {
  const dir = nonmatchingDir(wanted.module);
  const held = heldOf(scan, dir, wanted.chunks);
  const { earlier, later } = neighbours(held);
  const stubs = new Set(wanted.chunks.map((c) => c.stub));
  const symbols = new Set(wanted.chunks.map((c) => c.name));
  const unwanted = scan.statements.filter((s) => unwantedStub(s, dir, stubs, wanted.tree));
  const conditional = unwanted.filter((s) => regionAt(scan, s.start) !== undefined);
  const removed = unwanted.filter((s) => regionAt(scan, s.start) === undefined);
  const skips = new Map<number, number>([
    ...scan.directives.filter((t) => t.kind === 'comment' && t.terminated).map((t) => [t.start, t.end] as const),
    ...removed.map((s) => [s.start, s.end] as const),
  ]);
  const strangers = scan.definitions.filter((d) => d.name !== '' && !symbols.has(d.name));
  const retired = wanted.retired === undefined ? undefined : new Set(wanted.retired);
  const previousStubs = new Set(wanted.previousStubs ?? []);
  /** Each stranger's slots: the missing chunks whose stubs go where it lies, in ROM order. */
  const slots = new Map<CDefinition, WantedChunk[]>();
  const insertions: TextEdit[] = [];
  /** The stubs with no safe place: the text's end or a region (placement), or a fragment romlift does not read. */
  const unplaced: string[] = [];
  wanted.chunks.forEach((chunk, k) => {
    if (held[k] !== undefined) return;
    const e = earlier[k];
    const l = later[k];
    const before = e === undefined ? undefined : held[e];
    const after = l === undefined ? undefined : held[l];
    const from = before?.end ?? 0;
    const to = after?.start ?? text.length;
    for (const d of strangers) if (d.start >= from && d.end <= to) slots.set(d, [...(slots.get(d) ?? []), chunk]);
    const edit = unread.length > 0 ? undefined : placement(text, scan, skips, includeAsmStatement(wanted.module, chunk.stub), before, after);
    if (edit === undefined) unplaced.push(chunk.stub);
    else insertions.push(edit);
  });
  const header = insertions.length > 0 ? headerInsertion(text, scan) : undefined;
  const edits: TextEdit[] = [...(header === undefined ? [] : [header]), ...insertions];
  for (const statement of removed) edits.push(removalOf(text, statement));
  /** The chunk of the previous tree's own directory a stranger took the place of (correctness-a2-1). */
  const replacedOf = (d: CDefinition): WantedChunk | undefined => (retired === undefined || retired.has(d.name) ? undefined : slots.get(d)?.find((c) => previousStubs.has(c.stub)));
  const stale = strangers.filter((d) => (retired === undefined ? slots.has(d) : retired.has(d.name) || replacedOf(d) !== undefined));
  const { where, extra } = whereOf(wanted);
  const diagnostics: Diagnostic<ReconcileCode>[] = [...orderDiagnostics(wanted, held)];
  if (unplaced.length > 0 && unread.length > 0) {
    const files = unread.map((u) => `"${u.spelled}" (line ${u.line})`).join(', ');
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} gains the INCLUDE_ASM of ${unplaced.join(', ')}, but it #includes ${files}, which romlift does not read (it reads only src/*.c), so it cannot tell whether that file defines them: move the C into ${where}, or name the included file src/<name>.c, or write the statements yourself`, extra));
  } else if (unplaced.length > 0) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} has no safe place for the INCLUDE_ASM of ${unplaced.join(', ')}: the text ends inside a comment, a literal, a directive or an unclosed #if, or the stub would go between two chunks one #if region holds; close it, or write the statements yourself (in each branch of the region)`, extra));
  }
  for (const s of conditional) {
    const gone = s.dir === dir ? `module ${wanted.module} no longer has ${s.name}` : `no module of romlift.toml has ${chunkFileOf(s.dir, s.name)} any more`;
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_CONDITIONAL_STUB', `${where} holds INCLUDE_ASM("${s.dir}", ${s.name}); (line ${s.line}) inside an #if region, and ${gone}: romlift never edits conditional code, so rename or remove it there yourself (and the C beside it)`, extra));
  }
  for (const d of stale) diagnostics.push(staleDiagnostic(wanted, d, slots.get(d)?.[0], replacedOf(d)));
  const isStale = new Set(stale);
  return { edits: joinAtOffsets(edits, eolOf(text)), diagnostics, unplaced, undeclared: strangers.filter((d) => !isStale.has(d)) };
}

/**
 * The plan of a file the scanner cannot split: no edit. Whether the file needs one is read from what the scanner can
 * still trust (fix round 5, correctness-b0-1): the stubs its tokens spell at any depth (anyDepthStatements, since a
 * swallowed stub is no statement of the scan) and the definitions it read (compiledDefinitions). A wanted chunk
 * neither names, a stub that would go, or one inside a region that would (planScanned's E_C_CONDITIONAL_STUB): the file
 * needs an edit romlift cannot place, E_C_UNSCANNABLE. Otherwise W_C_UNSCANNABLE, with planScanned's warnings, the
 * E_C_STALE_DEFINITION of a definition of a function of the previous tree, and its undeclared definitions for the caller.
 */
function unscannablePlan(scan: CFileScan, wanted: IncludeAsmWanted, plan: Omit<IncludeAsmPlan, 'included'>): Omit<IncludeAsmPlan, 'included'> {
  const dir = nonmatchingDir(wanted.module);
  const stubs = new Set(wanted.chunks.map((c) => c.stub));
  const statements = anyDepthStatements(scan);
  const included = new Set(statements.filter((s) => s.dir === dir).map((s) => s.name));
  const defined = new Set(compiledDefinitions(scan).definitions.map((d) => d.name));
  const missing = wanted.chunks.some((c) => !included.has(c.stub) && !defined.has(c.name));
  const needsEdit = missing || statements.some((s) => unwantedStub(s, dir, stubs, wanted.tree)) || plan.diagnostics.some((d) => d.code === 'E_C_CONDITIONAL_STUB');
  const { where, extra } = whereOf(wanted);
  if (needsEdit) {
    const message = `${where} cannot be scanned for its INCLUDE_ASM lines, and romlift.toml needs them changed: ${scan.unscannable.map((u) => u.reason).join('; ')}; romlift edits nothing in it: make the branches of the conditional agree (or move it inside the function), or close the definition, or change its INCLUDE_ASM lines yourself`;
    return { edits: [], diagnostics: [diagnostic(ReconcileCodes, 'E_C_UNSCANNABLE', message, extra)], unplaced: [], undeclared: [] };
  }
  const retired = new Set(wanted.retired ?? []);
  const stale = scan.definitions.filter((d) => retired.has(d.name));
  const diagnostics = [
    unscannableWarning(where, wanted.path, scan.unscannable, 'its INCLUDE_ASM lines already match romlift.toml as far as it reads, so nothing is edited'),
    ...plan.diagnostics.filter((d) => d.severity !== 'error'),
    ...stale.map((d) => staleDiagnostic(wanted, d, undefined, undefined)),
  ];
  const symbols = new Set(wanted.chunks.map((c) => c.name));
  return { edits: [], diagnostics, unplaced: [], undeclared: scan.definitions.filter((d) => d.name !== '' && !symbols.has(d.name) && !retired.has(d.name)) };
}

/**
 * W_C_UNSCANNABLE for a C file the scanner cannot split (`why`; `where` names it, `path` its project path when known),
 * whose check went on over what it read (`outcome`): raised by planIncludeAsm and, for a C file of no module, by
 * core/workflow/c-stubs.ts.
 */
export function unscannableWarning(where: string, path: string | undefined, why: readonly CUnscannable[], outcome: string): Diagnostic<ReconcileCode> {
  return diagnostic(ReconcileCodes, 'W_C_UNSCANNABLE', `${where} cannot be scanned exactly: ${why.map((u) => u.reason).join('; ')}; ${outcome}; romlift may miss a definition or a stub in it`, path === undefined ? {} : { path });
}

/**
 * The edits in text order (an insertion before a removal at its offset), the insertions at one offset joined into one
 * edit in wanted order, so stubs that follow an unterminated last line get one line terminator (`eol`) between them,
 * not two (`\nA\n` then `\nB\n` become `\nA\nB\n`).
 */
function joinAtOffsets(edits: readonly TextEdit[], eol: string): readonly TextEdit[] {
  const sorted = edits.map((edit, index) => ({ edit, index })).sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index);
  const out: TextEdit[] = [];
  for (const { edit } of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || last.start !== edit.start || last.end !== last.start || edit.end !== edit.start) {
      out.push(edit);
      continue;
    }
    const text = last.text.endsWith(eol) && edit.text.startsWith(eol) ? last.text + edit.text.slice(eol.length) : last.text + edit.text;
    out[out.length - 1] = { ...last, text };
  }
  return out;
}
