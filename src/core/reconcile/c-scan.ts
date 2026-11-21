// The C scanner and the "C defines it" rule (architecture §6.3 `c-stub`, §6.6, D74 e), with the include resolution
// that follows a module's file into its src/*.c fragments and headers; the INCLUDE_ASM planner (include-asm.ts) and
// the readers of a C file (core/verify/c-stub.ts, core/workflow/c-stubs.ts, core/workflow/generate.ts) read through it.
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
//
// compiledDefinitions is the one rule for what a file defines for the default build (a definition outside every
// conditional, or in every branch of one with an `#else`). withFragments adds what the src/*.c fragments a file
// `#include`s at file scope hold, at the `#include` line; macroProvided says whether INCLUDE_ASM is defined by the
// file, a fragment it includes or a header either reaches, as `cpp -nostdinc -I include` finds them, behind symbolic
// links too (headerCandidates: a quoted include from the including file's real directory, phase 6; include-asm.ts's
// module comment says how the planner uses each).
import {
  INCLUDE_ASM_HEADER_NAME,
  INCLUDE_ASM_HEADER_PATH,
  INCLUDE_DIR,
  isHeaderPath,
} from '../../foundation/util/project-files.ts';
import { directiveOf, isTrivia, tokenizeC } from './c-tokens.ts';
import type { CToken } from './c-tokens.ts';

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
  /**
   * The project path of the src/*.c fragment that holds it, when the file only #includes it (fix round 7,
   * correctness-b2-1): its offsets and line are then those of the file's `#include` line, `fragmentLine` its own.
   */
  readonly via?: string;
  readonly fragmentLine?: number;
  /** The `#include` lines that reach `via` from the file, and its place in text order through them (CDefinition's, fix round 8). */
  readonly chain?: readonly CIncludeLink[];
  readonly order?: readonly number[];
}

/**
 * One `#include` on the way from a module's file to a fragment (fix round 8, correctness-c0-3): the project path of
 * the file that holds the directive, and its line there.
 */
export interface CIncludeLink {
  readonly from: string;
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
  /**
   * For an item of a fragment (fix round 8): `chain`, the `#include` lines that reach `via` from the file, the file's
   * own first (correctness-c0-3, so a message names the file that includes `via` directly); `order`, the offsets of
   * those `#include` lines in their files and then the item's own offset in `via`, which order the file's items as the
   * preprocessor reads them (architecture-c0-3: W_C_ORDER inside a fragment).
   */
  readonly chain?: readonly CIncludeLink[];
  readonly order?: readonly number[];
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

/**
 * What the include resolution reads (withFragments, macroProvided): the fields of include-asm.ts IncludeAsmWanted
 * of the same names, which document them; an IncludeAsmWanted is one.
 */
export interface CIncludeInputs {
  /** The file's project path (`src/<module>.c`); without it no include is followed. */
  readonly path?: string;
  /** The text of each src/*.c that is no module's source, by project path. */
  readonly fragments?: ReadonlyMap<string, string>;
  /** The module each module's source belongs to, by project path. */
  readonly sources?: ReadonlyMap<string, string>;
  /** The text of every file under `include/` and of every `.h` under `src/`, by project path. */
  readonly headers?: ReadonlyMap<string, string>;
  /** Where a header or a C file is behind its symbolic links, by its key (IncludeRealPaths); absent, where its key says. */
  readonly headerRealPaths?: IncludeRealPaths;
}

/**
 * A file's key (a key of the headers or of the C texts) -> its directory's real path joined with its own name: relative
 * to the project inside it, absolute outside it (ProjectInputs.headerRealPaths, phase 6; roadmap "Carried from phase 4",
 * D89 a, D90 a). The directory, not the file: a header that is itself a link to a file keeps its link's directory,
 * since cpp resolves a quoted include from the directory it opened the file in, whose symbolic links the system then
 * follows (a `..` behind a linked directory leads to the parent of the link's target). A key with no entry is where
 * its spelling says.
 */
export type IncludeRealPaths = ReadonlyMap<string, string>;

/** A held item's place in text order (include-asm.ts Held, CDefinition, IncludeAsmStatement): its offset, or the offsets that reach it through the includes. */
export interface CTextOrder {
  readonly start: number;
  readonly order?: readonly number[];
}

/** The directive name of a preprocessor line (`#  ifdef X` -> `ifdef`); '' for a null directive (c-tokens.ts directiveOf). */
function directiveName(text: string): string {
  return directiveOf({ text, start: 0 }).name;
}

/** The macro a `#define` line names (`#define INCLUDE_ASM(DIR, NAME) …` -> `INCLUDE_ASM`); undefined for another directive. */
function definedMacro(text: string): string | undefined {
  const directive = directiveOf({ text, start: 0 });
  const macro = directive.body[0];
  return directive.name === 'define' && macro?.kind === 'identifier' ? macro.text : undefined;
}

/**
 * The outermost conditional regions the preprocessor lines of `tokens` open and close, with their branches and the
 * conditionals nested in them; a stray `#endif` is ignored.
 */
function conditionalsOf(tokens: readonly CToken[], length: number): readonly CConditional[] {
  const out: CConditional[] = [];
  let depth = 0;
  let open:
    | {
        readonly start: number;
        branchStart: number;
        readonly branches: COffsets[];
        hasElse: boolean;
        readonly nested: COffsets[];
      }
    | undefined;
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
        out.push({
          start: open.start,
          end: t.end,
          terminated: true,
          branches: open.branches,
          hasElse: open.hasElse,
          nested: open.nested,
        });
        open = undefined;
      }
    }
  }
  if (open !== undefined) {
    open.branches.push({ start: open.branchStart, end: length });
    out.push({
      start: open.start,
      end: length,
      terminated: false,
      branches: open.branches,
      hasElse: open.hasElse,
      nested: open.nested,
    });
  }
  return out;
}

/** The quoted path of an `#include "…"` line, or undefined for any other line (an `<…>` include among them). */
function quotedInclude(text: string): string | undefined {
  return includeOf(text, '"', '"');
}

/**
 * The path an `#include "…"` (`angle` false) or `#include <…>` (`angle` true) line spells, or undefined for any other
 * line (fix round 11, correctness-d0-2: the scaffold's `cpp -nostdinc -I include` finds an angle include under
 * `include/`).
 */
export function includeSpelling(text: string): IncludeSpelling | undefined {
  const quoted = includeOf(text, '"', '"');
  if (quoted !== undefined) return { spelled: quoted, angle: false };
  const angled = includeOf(text, '<', '>');
  return angled === undefined ? undefined : { spelled: angled, angle: true };
}

/** One `#include` line's spelling: the path between its quotes or angle brackets, and which of the two. */
export interface IncludeSpelling {
  readonly spelled: string;
  readonly angle: boolean;
}

/**
 * Every `#include "…"` and `#include <…>` line of `text`, in text order: each preprocessor line the scanner reads, inside
 * a conditional or a body too (the include resolution evaluates no `#if`), never one in a comment or a literal. What
 * macroProvided follows, and what the shell reads the headers of (shell/project/read-inputs.ts readHeaderTexts).
 */
export function includesOf(text: string): readonly IncludeSpelling[] {
  return scanC(text).directives.flatMap((t) => {
    const include = t.kind === 'preprocessor' ? includeSpelling(t.text) : undefined;
    return include === undefined ? [] : [include];
  });
}

/** The path between `open` and `close` right after the `include` of an `#include` line, or undefined. */
function includeOf(text: string, open: string, close: string): string | undefined {
  if (directiveName(text) !== 'include') return undefined;
  const at = text.indexOf(open);
  const end = at < 0 ? -1 : text.indexOf(close, at + 1);
  const before = at < 0 ? '' : text.slice(text.indexOf('include') + 'include'.length, at);
  return end < 0 || before.trim() !== '' ? undefined : text.slice(at + 1, end);
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
  const group = (s: ScanState): boolean =>
    s.braces === 0 && s.definition === undefined && s.item.some((t) => isPunct(t, '('));
  return (
    a.braces === b.braces && a.parens === b.parens && a.definition?.name === b.definition?.name && group(a) === group(b)
  );
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
      if (name === 'if' || name === 'ifdef' || name === 'ifndef')
        open.push({
          opened: state(),
          line: t.line,
          inside: definition !== undefined,
          broken: false,
          sawElse: false,
          ends: [],
        });
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
              unscannable.push({
                line: at.line,
                reason: `the branches of the conditional on line ${at.line} end (line ${t.line}) with other braces, parentheses or an unfinished head open than each other`,
              });
            }
            restore(first);
            // A bare unfinished item the region leaves at file scope (`END_NONMATCH`, a `static` alone) names no
            // head: it ends with the region, so the next definition starts at its own head, outside the region.
            if (
              !at.inside &&
              definition === undefined &&
              braces === 0 &&
              parens === 0 &&
              item.length > 0 &&
              !item.some((k) => isPunct(k, '('))
            )
              closeOther(t.end);
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
        if (item.length === 1)
          unscannable.push({
            line: t.line,
            reason: `a block at file scope (line ${t.line}) follows no head, as in a K&R definition`,
          });
        else if (name === '')
          unscannable.push({
            line: first?.line ?? t.line,
            reason: `the function defined on line ${first?.line ?? t.line} has a head whose name the scanner cannot read`,
          });
      }
      braces++;
    } else if (isPunct(t, '}')) {
      braces = Math.max(0, braces - 1);
      const closing = braces === 0 && definition !== undefined ? open.find((c) => c.inside && !c.broken) : undefined;
      if (closing !== undefined) {
        // A branch of a conditional opened inside a body closes that body: the items after it differ by branch.
        closing.broken = true;
        unscannable.push({
          line: closing.line,
          reason: `a branch of the conditional on line ${closing.line}, inside a definition, closes that definition (line ${t.line})`,
        });
      }
      if (braces === 0 && definition !== undefined) {
        definitions.push({
          name: definition.name,
          start: definition.first.start,
          end: t.end,
          line: definition.first.line,
        });
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
    definitions.push({
      name: definition.name,
      start: definition.first.start,
      end: text.length,
      line: definition.first.line,
    });
    unscannable.push({
      line: definition.first.line,
      reason: `the definition${definition.name === '' ? '' : ` of ${definition.name}`} on line ${definition.first.line} never closes its body`,
    });
  } else closeOther(text.length);
  const last = tokens[tokens.length - 1];
  const unterminated = last !== undefined && !last.terminated ? [last] : [];
  unscannable.sort((a, b) => a.line - b.line);
  return {
    statements,
    definitions,
    others,
    directives,
    unterminated,
    tokens,
    conditionals: conditionalsOf(tokens, text.length),
    unscannable,
  };
}

/**
 * Whether item `d` lies wholly inside one preprocessor conditional, a branch the default build may not compile (the
 * NONMATCHING pattern's `#ifdef`). A definition whose head a conditional holds but whose body runs past its `#endif`
 * (`#ifndef NON_MATCHING <head> { <register pin> #else <head> { #endif <body> }`) is compiled in every build.
 */
export function insideRegion(scan: CFileScan, d: COffsets): boolean {
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
  const holds = (branch: COffsets, e: CDefinition): boolean =>
    e.start >= branch.start && e.end <= branch.end && !region.nested.some((n) => e.start >= n.start && e.start < n.end);
  const [first, ...others] = region.branches;
  return (
    first !== undefined &&
    holds(first, d) &&
    others.every((branch) => scan.definitions.some((e) => e.name === d.name && holds(branch, e)))
  );
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
  | {
      readonly scannable: false;
      readonly definitions: readonly CDefinition[];
      readonly unscannable: readonly CUnscannable[];
    };

/**
 * The one rule for "the C defines it" (architecture-a2-3, fix round 5 architecture-b0-2), the scanner's precondition
 * included: read by the planner (a definition holds its chunk: heldOf, and unscannablePlan for a file the scanner
 * cannot split), by the C files of no module and the fragments a module's file includes (c-stubs.ts), and by the
 * DecompState of a project (core/workflow/generate.ts).
 */
export function compiledDefinitions(scan: CFileScan): CompiledDefinitions {
  const definitions = compiledOf(scan);
  return scan.unscannable.length === 0
    ? { scannable: true, definitions }
    : { scannable: false, definitions, unscannable: scan.unscannable };
}

/**
 * Every `INCLUDE_ASM("<dir>", <name>);` the tokens of `scan` spell, at any depth: a file the scanner cannot split
 * still shows every stub it names (planIncludeAsm's check that such a file needs no edit).
 */
export function anyDepthStatements(scan: CFileScan): readonly IncludeAsmStatement[] {
  const code = scan.tokens.filter((t) => !isTrivia(t));
  const out: IncludeAsmStatement[] = [];
  code.forEach((t, i) => {
    if (t.kind !== 'identifier' || t.text !== INCLUDE_ASM_MACRO) return;
    const statement = statementOf(code.slice(i, i + 7));
    if (statement !== undefined) out.push(statement);
  });
  return out;
}

/** The outermost conditional region `offset` lies in, if any. */
export function regionAt(scan: CFileScan, offset: number): CConditional | undefined {
  return scan.conditionals.find((c) => c.start <= offset && offset < c.end);
}

/**
 * Fragment `via` named by the `#include` lines that reach it from `where`, the module's file (fix round 8,
 * correctness-c0-3): `src/b.c, which src/a.c includes (line 3), which src/main.c includes (line 68)`. Without `chain`,
 * `where` includes it directly at `line`.
 */
export function fragmentPhrase(via: string, where: string, line: number, chain?: readonly CIncludeLink[]): string {
  const links = chain === undefined || chain.length === 0 ? [{ from: where, line }] : chain;
  return [via, ...[...links].reverse().map((l) => `which ${l.from} includes (line ${l.line})`)].join(', ');
}

/** The text-order key of a held item: its offset in the file, or the offsets that reach it through the includes. */
function orderKey(h: CTextOrder): readonly number[] {
  return h.order ?? [h.start];
}

/** Whether held item `a` comes after `b` in the text the preprocessor reads (keys compared element by element). */
export function laterThan(a: CTextOrder, b: CTextOrder): boolean {
  const ka = orderKey(a);
  const kb = orderKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    const x = ka[i] ?? 0;
    const y = kb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return ka.length > kb.length;
}

/** Whether a preprocessor line of `scan` includes `include_asm.h` or `#define`s INCLUDE_ASM. */
function providesMacro(scan: CFileScan, from: string, realPaths: IncludeRealPaths | undefined): boolean {
  return scan.directives.some((t) => {
    if (t.kind !== 'preprocessor') return false;
    if (definedMacro(t.text) === INCLUDE_ASM_MACRO) return true;
    const include = includeSpelling(t.text);
    if (include === undefined) return false;
    return (
      (!include.angle && include.spelled === INCLUDE_ASM_HEADER_NAME) ||
      headerCandidates(from, include.spelled, include.angle, realPaths).includes(INCLUDE_ASM_HEADER_PATH)
    );
  });
}

/** The directory part of a key or real path (`''` for one at the project's top, `/` for one at the root). */
function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : slash === 0 ? '/' : path.slice(0, slash);
}

/**
 * `spelled` opened from directory `base` as cpp opens it, as a key: `base` is a real directory (no symbolic link in it),
 * so a `..` that leads `spelled` takes `base`'s last name off (or, at the project's top, adds a `..`: the directory
 * above the project), exactly as the system resolves it; once `spelled` has named a directory of its own, which may be
 * a link, a later `..` stays written, and the shell opens the key as written, so the system resolves it (`gba/../x.h`).
 * `.` and empty names are dropped.
 */
function includeJoin(base: string, spelled: string): string {
  const absolute = base.startsWith('/');
  const parts = base.split('/').filter((name) => name !== '');
  let named = false;
  for (const name of spelled.split('/')) {
    if (name === '' || name === '.') continue;
    if (name !== '..') {
      parts.push(name);
      named = true;
    } else if (named || parts.length === 0 || parts[parts.length - 1] === '..') {
      if (named || !absolute) parts.push(name);
    } else {
      parts.pop();
    }
  }
  return `${absolute ? '/' : ''}${parts.join('/')}`;
}

/**
 * The keys an `#include` of the file keyed `from` names, in the order the scaffold's `cpp -nostdinc -I include` tries
 * them (phase 6, cpp-exact behind symbolic links; roadmap "Carried from phase 4", D89 a, D90 a): an absolute include as
 * written; a quoted include from the real directory of the including file first (`realPaths`, its directory's real path; a file with no entry is
 * where its key says), then from `include/`, as the system finds it through a linked `include/`; an angle include from
 * `include/` alone. The first that is a file is the one cpp reads; the shell reads it under that key
 * (readHeaderTexts), so headerPath finds it.
 */
export function headerCandidates(
  from: string,
  spelled: string,
  angle: boolean,
  realPaths?: IncludeRealPaths,
): readonly string[] {
  // An absolute include is opened as written, searched nowhere.
  if (spelled.startsWith('/')) return [includeJoin('/', spelled)];
  const rooted = includeJoin('', `${INCLUDE_DIR}/${spelled}`);
  if (angle) return [rooted];
  const own = includeJoin(directoryOf(realPaths?.get(from) ?? from), spelled);
  return own === rooted ? [own] : [own, rooted];
}

/**
 * The key an `#include` of the file keyed `from` names: the first of headerCandidates that is a file of `headers`, as
 * cpp reads the first it finds (fix round 11, correctness-d0-2; phase 6, from the real directory of the including file,
 * `realPaths`). Undefined when none is (without `headers`: from a file under `include/`, its own-directory key, from any
 * other, the `include/` one).
 */
export function headerPath(
  from: string,
  spelled: string,
  angle: boolean,
  headers?: ReadonlyMap<string, string>,
  realPaths?: IncludeRealPaths,
): string | undefined {
  const candidates = headerCandidates(from, spelled, angle, realPaths);
  if (headers !== undefined) return candidates.find((c) => headers.has(c));
  return !angle && (realPaths?.get(from) ?? from).startsWith(`${INCLUDE_DIR}/`)
    ? candidates[0]
    : candidates[candidates.length - 1];
}

/**
 * Whether INCLUDE_ASM comes from the file itself, from a src/*.c fragment it includes (`included`, withFragments'
 * list, transitively; fix round 11, correctness-d0-1) or from a header one of them includes (fix round 10,
 * correctness-c2-1): their own lines include `include_asm.h` or define the macro, or one of their includes that
 * resolves to a file of `wanted.headers` does (headerPath: quoted or angle, fix round 11, correctness-d0-2; from the
 * including file's real directory, `wanted.headerRealPaths`, phase 6; followed transitively, each header once, so an
 * include cycle ends).
 */
export function macroProvided(scan: CFileScan, wanted: CIncludeInputs, included: readonly string[]): boolean {
  const { headers, path, fragments, headerRealPaths: realPaths } = wanted;
  if (providesMacro(scan, path ?? '', realPaths)) return true;
  if (path === undefined) return false;
  const pending: { readonly from: string; readonly scan: CFileScan }[] = [{ from: path, scan }];
  for (const fragment of included) {
    const fragmentScan = scanC(fragments?.get(fragment) ?? '');
    if (providesMacro(fragmentScan, fragment, realPaths)) return true;
    pending.push({ from: fragment, scan: fragmentScan });
  }
  if (headers === undefined) return false;
  const seen = new Set<string>();
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    for (const t of next.scan.directives) {
      const include = t.kind === 'preprocessor' ? includeSpelling(t.text) : undefined;
      const found =
        include === undefined ? undefined : headerPath(next.from, include.spelled, include.angle, headers, realPaths);
      if (found === undefined || seen.has(found)) continue;
      seen.add(found);
      const header = scanC(headers.get(found) ?? '');
      if (providesMacro(header, found, realPaths)) return true;
      pending.push({ from: found, scan: header });
    }
  }
  return false;
}

/**
 * An `#include "…"` at file scope that is no fragment romlift reads (a file that may define functions): its spelling,
 * its line in `from` (the module's file or a fragment it includes, reached through `chain`), and `module` when it names
 * that module's source.
 */
export interface UnreadInclude {
  readonly spelled: string;
  readonly line: number;
  readonly from: string;
  readonly chain: readonly CIncludeLink[];
  readonly module?: string;
}

/** A fragment the scanner cannot split (`why`), included at line `line` of the module's file, through `chain`. */
export interface UnscannableFragment {
  readonly path: string;
  readonly line: number;
  readonly chain: readonly CIncludeLink[];
  readonly why: readonly CUnscannable[];
}

/** `path` of an `#include "<spelled>"` in the file at project path `from`, resolved from its directory; undefined above the root. */
export function resolveInclude(from: string, spelled: string): string | undefined {
  const parts = from.split('/').slice(0, -1);
  for (const segment of spelled.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') parts.push(segment);
    else if (parts.pop() === undefined) return undefined;
  }
  return parts.join('/');
}

/** The quoted includes of `scan` at file scope: outside every item (an include inside an initializer or a body defines no function of its own). */
function fileScopeIncludes(scan: CFileScan): readonly { readonly token: CToken; readonly spelled: string }[] {
  const items: readonly COffsets[] = [...scan.statements, ...scan.definitions, ...scan.others];
  return scan.directives.flatMap((token) => {
    const spelled = token.kind === 'preprocessor' ? quotedInclude(token.text) : undefined;
    return spelled === undefined || items.some((i) => token.start >= i.start && token.start < i.end)
      ? []
      : [{ token, spelled }];
  });
}

/**
 * `scan` with what the fragments the file includes at file scope hold (`wanted.fragments`), each fragment's own includes
 * followed in turn: their compiled definitions and their INCLUDE_ASM statements (anyDepthStatements for a fragment the
 * scanner cannot split), added at the file's `#include` line (`via` names the fragment; fix round 6, correctness-b1-3;
 * fix round 7, correctness-b2-1); the fragments included, in text order; the quoted includes that are no fragment and
 * no header (`.h`), a module's source among them (architecture-b2-5); and the fragments the scanner cannot split
 * (architecture-b2-4).
 */
export function withFragments(
  scan: CFileScan,
  wanted: CIncludeInputs,
): {
  readonly scan: CFileScan;
  readonly included: readonly string[];
  readonly unread: readonly UnreadInclude[];
  readonly unscannable: readonly UnscannableFragment[];
} {
  const { fragments, path } = wanted;
  if (fragments === undefined || path === undefined) return { scan, included: [], unread: [], unscannable: [] };
  const definitions: CDefinition[] = [];
  const statements: IncludeAsmStatement[] = [];
  const included: string[] = [];
  const unread: UnreadInclude[] = [];
  const unscannable: UnscannableFragment[] = [];
  // `chain` and `prefix`: the #include lines that reach `from`, and their offsets (CDefinition chain, order).
  const visit = (
    from: string,
    fileScan: CFileScan,
    top: CToken | undefined,
    chain: readonly CIncludeLink[],
    prefix: readonly number[],
  ): void => {
    for (const { token, spelled } of fileScopeIncludes(fileScan)) {
      const at = top ?? token;
      const resolved = resolveInclude(from, spelled);
      // A file including itself, or a fragment included twice, is read once.
      if (resolved === path || (resolved !== undefined && included.includes(resolved))) continue;
      const module = resolved === undefined ? undefined : wanted.sources?.get(resolved);
      const text = resolved === undefined || module !== undefined ? undefined : fragments.get(resolved);
      if (resolved === undefined || text === undefined) {
        if (module !== undefined) unread.push({ spelled, line: token.line, from, chain, module });
        else if (!isHeaderPath(spelled)) unread.push({ spelled, line: token.line, from, chain });
        continue;
      }
      included.push(resolved);
      const links = [...chain, { from, line: token.line }];
      const offsets = [...prefix, token.start];
      const fragment = scanC(text);
      const compiled = compiledDefinitions(fragment);
      if (!compiled.scannable)
        unscannable.push({ path: resolved, line: at.line, chain: links, why: compiled.unscannable });
      const place = { start: at.start, end: at.end, line: at.line, via: resolved, chain: links };
      for (const d of compiled.definitions) definitions.push({ ...place, name: d.name, order: [...offsets, d.start] });
      for (const s of compiled.scannable ? fragment.statements : anyDepthStatements(fragment))
        statements.push({ ...place, dir: s.dir, name: s.name, fragmentLine: s.line, order: [...offsets, s.start] });
      visit(resolved, fragment, at, links, offsets);
    }
  };
  visit(path, scan, undefined, [], []);
  if (definitions.length === 0 && statements.length === 0) return { scan, included, unread, unscannable };
  const byStart = (a: COffsets, b: COffsets): number => a.start - b.start;
  return {
    scan: {
      ...scan,
      definitions: [...scan.definitions, ...definitions].sort(byStart),
      statements: [...scan.statements, ...statements].sort(byStart),
    },
    included,
    unread,
    unscannable,
  };
}
