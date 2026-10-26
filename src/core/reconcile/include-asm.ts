// The INCLUDE_ASM planner (architecture §6.3 `c-stub`, §6.6, D74 e): reads a C file through the scanner (c-scan.ts)
// and plans the edits that bring its stubs in line with its module's functions.
//
// scanC (c-scan.ts) splits the file's tokens into file-scope items (INCLUDE_ASM statements, function definitions,
// other code, directives) and reads its preprocessor conditionals as the preprocessor would; a file it cannot split is
// unscannable (c-scan.ts says when, architecture-b2-9 split the scanner out of this file).
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
// writes with only the C E_C_DEFINITION_MOVED sent there; since fix round 10 (correctness-c2-1) what decides is what
// defines the macro: the file's own lines, the src/*.c fragments it includes and the headers their includes reach,
// quoted or angle, as `cpp -nostdinc -I include` finds them, transitively (IncludeAsmWanted.headers; fix round 11,
// correctness-d0-1, d0-2), behind symbolic links too (IncludeAsmWanted.headerRealPaths, phase 6), so a `global.h` that defines INCLUDE_ASM itself is never paired with a second definition
// that would include `macros.inc` twice. A src/*.c fragment the file `#include`s at file scope
// (IncludeAsmWanted.fragments) defines its functions there, at the `#include` line; a quoted include of a file romlift
// does not read that is no `.h` refuses every insertion (E_C_STUB_UNPLACED), since the fragment may define the
// function. An insertion takes the file's line terminator (`\r\n` in a CRLF file).
//
// Fix round 7 (correctness-b2-1, architecture-b2-4, b2-5): a fragment's INCLUDE_ASM statements hold their chunks at the
// `#include` line too (`IncludeAsmStatement.via`), and so do those of the src/*.c files it includes in turn, so a stub
// moved into a fragment is never inserted again. romlift never edits a fragment: a stub in one that would go is
// E_C_FRAGMENT_STUB, and a missing stub whose ROM-order place lies between two chunks one `#include` holds is
// E_C_STUB_UNPLACED, each naming the fragment; a fragment the scanner cannot split is W_C_UNSCANNABLE, or
// E_C_UNSCANNABLE when the file needs an edit. An include of another module's source is no fragment.
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
import { chunkFileOf, nonmatchingDir, NONMATCHINGS_ROOT } from '../../foundation/util/project-files.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { anyDepthStatements, compiledDefinitions, fragmentPhrase, insideRegion, laterThan, macroProvided, regionAt, scanC, withFragments } from './c-scan.ts';
import type { CDefinition, CFileScan, CIncludeLink, COffsets, CUnscannable, IncludeAsmStatement, UnreadInclude, UnscannableFragment } from './c-scan.ts';
import { ReconcileCodes } from './codes.ts';
import type { ReconcileCode } from './codes.ts';
import type { TextEdit } from './text-edit.ts';

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
   * The text of each src/*.c that is no module's source, by project path (fix round 6, correctness-b1-3; fix round 7,
   * correctness-b2-1): a file this one `#include`s at file scope (`#include "poly.inc.c"`, resolved from `path`'s
   * directory), and every such file that one includes in turn, holds its compiled definitions and its INCLUDE_ASM
   * statements here, at this file's `#include` line. romlift never edits a fragment: an unwanted stub in one is
   * E_C_FRAGMENT_STUB, a stub whose ROM-order place lies inside one E_C_STUB_UNPLACED, and a fragment the scanner cannot
   * split W_C_UNSCANNABLE (E_C_UNSCANNABLE when this file needs an edit). A quoted include of no file listed here whose
   * path does not end in `.h` is a file romlift does not read: a stub this file would gain is then E_C_STUB_UNPLACED,
   * since that file may define it. Undefined (or `path` undefined): includes are not followed.
   */
  readonly fragments?: ReadonlyMap<string, string>;
  /**
   * The module each module's source belongs to, by project path (fix round 7, architecture-b2-5): an include of one is
   * no fragment, since make compiles it on its own, so its functions would be built twice: E_C_MODULE_INCLUDED, an
   * error whether or not the file needs an edit (fix round 8, correctness-c0-1). Read only while includes are followed,
   * that is with `path` and `fragments` both given (pass an empty `fragments` to check the includes alone; fix round 9,
   * architecture-c1-3). An include inside a conditional region counts as well, even under `#if 0`.
   */
  readonly sources?: ReadonlyMap<string, string>;
  /**
   * The text of every file under `include/` and of every `.h` under `src/`, by project path (fix round 10,
   * correctness-c2-1; `src/` since fix round 11, correctness-d0-2): what decides whether a file that gains a stub needs
   * `#include "include_asm.h"`. The includes of the file and of the src/*.c fragments it includes (`fragments`, fix
   * round 11, correctness-d0-1) are resolved as the scaffold's `cpp -nostdinc -I include` resolves them (a quoted one
   * from the including file's own directory first, then from `include/`; an angle one from `include/` alone) and
   * followed, transitively and each file once: a file one of them `#define`s INCLUDE_ASM in, or that includes
   * `include_asm.h`, gets its macro from there (a `global.h` that defines it and includes `macros.inc` itself, whose
   * second inclusion would break the assembler). Read only with `path` given. Undefined: no header is followed, and
   * such a file gains the header unless it or a fragment it includes provides the macro.
   */
  readonly headers?: ReadonlyMap<string, string>;
  /**
   * Where each header and C file is behind its symbolic links (c-scan.ts IncludeRealPaths; phase 6, roadmap "Carried
   * from phase 4", D89 a, D90 a): a quoted include is resolved from the including file's real directory, as cpp opens
   * it, so a `..` behind a linked directory leads to the parent of the link's target; a header that lies behind a link
   * the shell does not walk into (one to the project directory, to a directory it is inside or to one above the
   * project) is in `headers` under the key an `#include` names (headerCandidates). Undefined: every file is where its
   * key says.
   */
  readonly headerRealPaths?: ReadonlyMap<string, string>;
}

/** The chunk files a run writes, and the directories it leaves to the user (IncludeAsmWanted.tree). */
export interface StubTree {
  readonly files: ReadonlySet<string>;
  readonly userDirs: ReadonlySet<string>;
}

export interface IncludeAsmPlan {
  /** Insertions and removals, in text order; apply with applyTextEdits. */
  readonly edits: readonly TextEdit[];
  /** W_C_ORDER (at most once), E_C_STUB_UNPLACED, E_C_STALE_DEFINITION, E_C_CONDITIONAL_STUB, E_C_FRAGMENT_STUB, E_C_MODULE_INCLUDED, E_C_UNSCANNABLE, W_C_UNSCANNABLE. */
  readonly diagnostics: readonly Diagnostic<ReconcileCode>[];
  /** Wanted stub names the planner found no safe place for (each also an E_C_STUB_UNPLACED). */
  readonly unplaced: readonly string[];
  /** Named definitions the module does not want and no E_C_STALE_DEFINITION reports, in text order. */
  readonly undeclared: readonly CDefinition[];
  /** The project paths of the fragments (IncludeAsmWanted.fragments) the file includes at file scope, in text order. */
  readonly included: readonly string[];
}

/**
 * Where a held chunk sits: offsets of its first token and of its end, its line; `via`, the fragment that holds it,
 * with the `#include` lines that reach it and its place in text order through them (CDefinition `chain`, `order`).
 */
interface Held {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly via?: string;
  readonly chain?: readonly CIncludeLink[];
  readonly order?: readonly number[];
}

/** `item`'s place, with the fragment that holds it. */
function heldAt(item: COffsets & Pick<CDefinition, 'line' | 'via' | 'chain' | 'order'>): Held {
  const at = { start: item.start, end: item.end, line: item.line };
  return item.via === undefined ? at : { ...at, via: item.via, chain: item.chain ?? [], order: item.order ?? [item.start] };
}


/**
 * For each wanted chunk, where the file holds it, or undefined: the first stub of `dir` that names its stub name
 * (inside a conditional too: the `#else` branch of the NONMATCHING pattern is the default build's), else the first
 * of its compiled definitions (compiledDefinitions: a definition inside a conditional does not hold its chunk, since
 * the default build may not compile it, correctness-a1-1, unless every branch of one with an `#else` defines it).
 * A fragment's stubs and definitions hold their chunks at the `#include` line (correctness-b2-1).
 */
function heldOf(scan: CFileScan, dir: string, chunks: readonly WantedChunk[]): readonly (Held | undefined)[] {
  const stubs = new Map<string, Held>();
  for (const s of scan.statements) if (s.dir === dir && !stubs.has(s.name)) stubs.set(s.name, heldAt(s));
  const defined = new Map<string, Held>();
  for (const d of compiledDefinitions(scan).definitions) if (!defined.has(d.name)) defined.set(d.name, heldAt(d));
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

/**
 * W_C_ORDER when the held wanted chunks are not in ROM order in the text the preprocessor reads (the first pair out of
 * order): the chunks of an #included fragment are ordered by their place in it (fix round 8, architecture-c0-3), and
 * two out of order in one fragment are reported naming it.
 */
function orderDiagnostics(wanted: IncludeAsmWanted, held: readonly (Held | undefined)[]): Diagnostic<ReconcileCode>[] {
  const order = wanted.chunks.flatMap((chunk, k) => {
    const h = held[k];
    return h === undefined ? [] : [{ name: chunk.name, ...h }];
  });
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (prev === undefined || cur === undefined || laterThan(cur, prev)) continue;
    const { where, extra } = whereOf(wanted);
    if (cur.via !== undefined && cur.via === prev.via) {
      return [diagnostic(ReconcileCodes, 'W_C_ORDER', `${fragmentPhrase(cur.via, where, cur.line, cur.chain)}, holds ${cur.name} before ${prev.name}, which comes first in ROM order`, { path: cur.via })];
    }
    if (cur.via === undefined && prev.via === undefined) {
      return [diagnostic(ReconcileCodes, 'W_C_ORDER', `${where} holds ${cur.name} before ${prev.name}, which comes first in ROM order`, extra)];
    }
    // The two in different files of the include chain (fix round 9, correctness-c1-3): each named with its file.
    const fileOf = (h: Held): string => (h.via === undefined ? where : fragmentPhrase(h.via, where, h.line, h.chain));
    return [diagnostic(ReconcileCodes, 'W_C_ORDER', `${where} holds ${cur.name} before ${prev.name}, which comes first in ROM order, through its includes: ${cur.name} is in ${fileOf(cur)}; ${prev.name} is in ${fileOf(prev)}`, cur.via === undefined ? extra : { path: cur.via })];
  }
  return [];
}

/**
 * The removal of statement `s`: its whole line (from the line's start through its newline) when nothing else is on
 * it; the statement and the blanks around it up to the newline when it is the last item of a shared line; the
 * statement and the blanks after it when it is the first (so the rest of the line keeps its place, not a stray blank:
 * found by the reconcile goldens, phase 6); else the statement alone.
 */
function removalOf(text: string, s: IncludeAsmStatement): TextEdit {
  const lineStart = lineStartOf(text, s.start);
  let after = s.end;
  while (text[after] === ' ' || text[after] === '\t') after++;
  const lineEnd = text[after] === '\n' ? after + 1 : text[after] === '\r' && text[after + 1] === '\n' ? after + 2 : after === text.length ? after : -1;
  const first = text.slice(lineStart, s.start).trim() === '';
  if (lineEnd >= 0 && first) return { start: lineStart, end: lineEnd, text: '', reason: 'remove-stub' };
  if (lineEnd >= 0) {
    let from = s.start;
    while (from > lineStart && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--;
    return { start: from, end: after, text: '', reason: 'remove-stub' };
  }
  if (first) return { start: s.start, end: after, text: '', reason: 'remove-stub' };
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
 * when the file needs none (fix round 6, correctness-b1-2): a file that gains a stub needs it unless it keeps an
 * INCLUDE_ASM statement of its own (whose macro its build defines some other way), or the macro comes from the file
 * itself, a src/*.c fragment it includes (`included`, fix round 11, correctness-d0-1) or a header either includes
 * (macroProvided). Which `#include` the file has decides nothing by itself: a file
 * whose every stub the plan removes (`removed`, a renamed module's or a `src/*.c` fragment made a module's source,
 * fix round 8, correctness-c0-1) gains the header when its `global.h` only declares its types (fix round 9,
 * correctness-c1-1), and does not when its `global.h` defines the macro itself (fix round 10, correctness-c2-1): the
 * generated header's guard does not cover the user's own definition, so both would include `macros.inc` and the
 * assembler would refuse its macros defined twice. It goes above the first line that is not a comment, after a leading
 * byte order mark and the comments that open the file (a licence, a file comment): a file the user wrote with only
 * the C of a function E_C_DEFINITION_MOVED sent there.
 */
function headerInsertion(text: string, scan: CFileScan, removed: readonly IncludeAsmStatement[], wanted: IncludeAsmWanted, included: readonly string[]): TextEdit | undefined {
  const gone = new Set(removed.map((s) => s.start));
  if (anyDepthStatements(scan).some((s) => !gone.has(s.start))) return undefined;
  if (macroProvided(scan, wanted, included)) return undefined;
  const eol = eolOf(text);
  const header = C_STUB_HEADER.split('\n').join(eol);
  const first = scan.tokens.find((t) => t.kind !== 'comment');
  if (first === undefined) {
    const needsNewline = text.length > bomLength(text) && !text.endsWith('\n');
    return { start: text.length, end: text.length, text: `${needsNewline ? eol : ''}${header}`, reason: 'add-header' };
  }
  // A comment that ends on the first code line (`/* … */ int x;`, or a block comment opened above it) keeps it whole.
  const lineStart = lineStartOf(text, first.start);
  const at = scan.tokens.some((t) => t.kind === 'comment' && t.start < first.start && t.end > lineStart) ? first.start : lineStart;
  return { start: at, end: at, text: at === lineStart ? header : `${eol}${header}`, reason: 'add-header' };
}

/**
 * `header` moved up to the first stub insertion when one goes above it (found by the reconcile goldens, phase 6): a
 * stub placed before the first held chunk goes above the comments that lead into it, which can be above the file's
 * first line of code, where the header goes, and an INCLUDE_ASM before the include that defines the macro does not
 * compile. At one offset the header comes first (joinAtOffsets keeps the edits' order).
 */
function aboveInsertions(text: string, header: TextEdit | undefined, insertions: readonly TextEdit[]): TextEdit | undefined {
  if (header === undefined) return undefined;
  const first = Math.min(...insertions.map((e) => e.start));
  if (!(first < header.start)) return header;
  const eol = eolOf(text);
  const body = C_STUB_HEADER.split('\n').join(eol);
  return { start: first, end: first, text: lineStartOf(text, first) === first ? body : `${eol}${body}`, reason: 'add-header' };
}

/**
 * The E_C_STALE_DEFINITION of definition `d`; `slot`: the missing chunk whose stub goes where it lies, if any;
 * `replaced`: when the previous tree is known and d is not one of its functions, the chunk of that tree's own
 * directory whose stub d took the place of.
 */
function staleDiagnostic(wanted: IncludeAsmWanted, d: CDefinition, slot: WantedChunk | undefined, replaced: WantedChunk | undefined): Diagnostic<ReconcileCode> {
  const { where: file, extra } = whereOf(wanted);
  // A definition of an included fragment: the file the user edits is the fragment (correctness-b1-3).
  // Named through the includes that reach it (fix round 8, correctness-c0-3); its line is then the #include's.
  const where = d.via === undefined ? file : `${fragmentPhrase(d.via, file, d.line, d.chain)},`;
  const at = d.via === undefined ? ` (line ${d.line})` : '';
  const dir = nonmatchingDir(wanted.module);
  if (replaced !== undefined) {
    return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name}${at} where the INCLUDE_ASM of ${replaced.stub} was, and module ${wanted.module} still has ${replaced.name}, which the file now neither includes nor defines: if you renamed ${replaced.name} in C, rename it in romlift.toml too (or the C back to ${replaced.name}); otherwise restore INCLUDE_ASM("${dir}", ${replaced.stub}); else make builds its bytes twice`, extra);
  }
  if (wanted.retired === undefined) {
    // The tree romlift last generated is not known, so d may be the user's helper.
    const stub = slot?.stub ?? '';
    return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name}${at}, which module ${wanted.module} no longer has, where the INCLUDE_ASM of ${stub} goes: if romlift.toml renamed it, rename the C function to ${slot?.name ?? ''}; otherwise write INCLUDE_ASM("${dir}", ${stub}); yourself`, extra);
  }
  const here = slot === undefined ? '' : `; the INCLUDE_ASM of ${slot.stub} goes where it lies: if romlift.toml renamed it to ${slot.name}, rename the C function to ${slot.name}`;
  return diagnostic(ReconcileCodes, 'E_C_STALE_DEFINITION', `${where} defines ${d.name}${at}, a function of the tree romlift last generated that romlift.toml no longer has${here}; a function it renamed takes its new name, in the source of the module that holds it now, and one it deleted loses its C, else make builds its bytes twice`, extra);
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
  const { scan, included, unread, unscannable } = withFragments(own, wanted);
  const plan = planScanned(text, scan, wanted, unread, included);
  return { ...unscannableFragments(own.unscannable.length === 0 ? plan : unscannablePlan(scan, wanted, plan), wanted, unscannable), included };
}


/** `from` of an unread include, named through the includes that reach it (fragmentPhrase). */
function unreadFrom(u: UnreadInclude, where: string): string {
  const last = u.chain[u.chain.length - 1];
  return last === undefined ? where : fragmentPhrase(u.from, where, last.line, u.chain);
}


/**
 * `plan` with the verdict on the fragments the scanner cannot split (architecture-b2-4), as unscannablePlan gives one
 * on the file itself: W_C_UNSCANNABLE for each when the file needs no edit of its INCLUDE_ASM lines, else
 * E_C_UNSCANNABLE for each and no edit, since a stub or definition the scanner missed in the fragment may hold a chunk
 * the edit would add again. Whether it needs one is read from what it needs, not from what was planned (fix round 8,
 * architecture-c0-1): an edit planned, a stub left unplaced (an edit refused), the file's own E_C_UNSCANNABLE, or a
 * stub that must go from a fragment or a conditional.
 */
function unscannableFragments(plan: Omit<IncludeAsmPlan, 'included'>, wanted: IncludeAsmWanted, fragments: readonly UnscannableFragment[]): Omit<IncludeAsmPlan, 'included'> {
  if (fragments.length === 0) return plan;
  const { where } = whereOf(wanted);
  const named = (f: UnscannableFragment): string => `${fragmentPhrase(f.path, where, f.line, f.chain)},`;
  const needsEdit = plan.edits.length > 0 || plan.unplaced.length > 0 || plan.diagnostics.some((d) => d.code === 'E_C_UNSCANNABLE' || d.code === 'E_C_FRAGMENT_STUB' || d.code === 'E_C_CONDITIONAL_STUB');
  if (!needsEdit) return { ...plan, diagnostics: [...plan.diagnostics, ...fragments.map((f) => unscannableWarning(named(f), f.path, f.why, `its definitions and INCLUDE_ASM lines were read as part of module ${wanted.module} as far as the scanner reads, and ${where} needs no INCLUDE_ASM line changed`))] };
  const refusals = fragments.map((f) =>
    diagnostic(ReconcileCodes, 'E_C_UNSCANNABLE', `${named(f)} cannot be scanned for its definitions and INCLUDE_ASM lines (${f.why.map((u) => u.reason).join('; ')}), and ${where} needs its INCLUDE_ASM lines changed: romlift edits nothing, since the fragment may hold a function it would add again; make the fragment's branches agree, or change the INCLUDE_ASM lines yourself`, { path: f.path }),
  );
  return { edits: [], diagnostics: [...plan.diagnostics, ...refusals], unplaced: [], undeclared: plan.undeclared };
}

/** Whether stub `s` is one the module's file must lose: of its own directory and unwanted, or of a directory the tree no longer writes it in. */
function unwantedStub(s: IncludeAsmStatement, dir: string, stubs: ReadonlySet<string>, tree: StubTree | undefined): boolean {
  if (s.dir === dir) return !stubs.has(s.name);
  if (tree === undefined || !s.dir.startsWith(`${NONMATCHINGS_ROOT}/`) || tree.userDirs.has(s.dir)) return false;
  return !tree.files.has(chunkFileOf(s.dir, s.name));
}

/**
 * planIncludeAsm over a scan, as if it could split the text; `unread`: the fragments it includes that romlift does not
 * read; `included`: those it reads (withFragments).
 */
function planScanned(text: string, scan: CFileScan, wanted: IncludeAsmWanted, unread: readonly UnreadInclude[], included: readonly string[]): Omit<IncludeAsmPlan, 'included'> {
  const dir = nonmatchingDir(wanted.module);
  const held = heldOf(scan, dir, wanted.chunks);
  const { earlier, later } = neighbours(held);
  const stubs = new Set(wanted.chunks.map((c) => c.stub));
  const symbols = new Set(wanted.chunks.map((c) => c.name));
  const unwanted = scan.statements.filter((s) => unwantedStub(s, dir, stubs, wanted.tree));
  // A fragment's stub is never edited (correctness-b2-1): E_C_FRAGMENT_STUB, naming the fragment.
  const inFragment = unwanted.filter((s) => s.via !== undefined);
  const local = unwanted.filter((s) => s.via === undefined);
  const conditional = local.filter((s) => regionAt(scan, s.start) !== undefined);
  const removed = local.filter((s) => regionAt(scan, s.start) === undefined);
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
  /** The stubs whose ROM-order place lies inside a fragment: between two chunks one `#include` holds (correctness-b2-1). */
  const insideFragment: { readonly chunk: WantedChunk; readonly before: Held & { readonly via: string }; readonly between: readonly [string, string] }[] = [];
  // An include of another module's source is E_C_MODULE_INCLUDED whatever the file needs (correctness-c0-1); the
  // others romlift does not read refuse only the insertions they might duplicate.
  const moduleIncludes = unread.filter((u) => u.module !== undefined);
  const otherUnread = unread.filter((u) => u.module === undefined);
  wanted.chunks.forEach((chunk, k) => {
    if (held[k] !== undefined) return;
    const e = earlier[k];
    const l = later[k];
    const before = e === undefined ? undefined : held[e];
    const after = l === undefined ? undefined : held[l];
    const from = before?.end ?? 0;
    const to = after?.start ?? text.length;
    for (const d of strangers) if (d.start >= from && d.end <= to) slots.set(d, [...(slots.get(d) ?? []), chunk]);
    if (before?.via !== undefined && after !== undefined && after.start === before.start) {
      insideFragment.push({ chunk, before: { ...before, via: before.via }, between: [wanted.chunks[e ?? 0]?.name ?? '', wanted.chunks[l ?? 0]?.name ?? ''] });
      return;
    }
    const edit = unread.length > 0 ? undefined : placement(text, scan, skips, includeAsmStatement(wanted.module, chunk.stub), before, after);
    if (edit === undefined) unplaced.push(chunk.stub);
    else insertions.push(edit);
  });
  const header = insertions.length > 0 ? aboveInsertions(text, headerInsertion(text, scan, removed, wanted, included), insertions) : undefined;
  const edits: TextEdit[] = [...(header === undefined ? [] : [header]), ...insertions];
  for (const statement of removed) edits.push(removalOf(text, statement));
  /** The chunk of the previous tree's own directory a stranger took the place of (correctness-a2-1). */
  const replacedOf = (d: CDefinition): WantedChunk | undefined => (retired === undefined || retired.has(d.name) ? undefined : slots.get(d)?.find((c) => previousStubs.has(c.stub)));
  const stale = strangers.filter((d) => (retired === undefined ? slots.has(d) : retired.has(d.name) || replacedOf(d) !== undefined));
  const { where, extra } = whereOf(wanted);
  const diagnostics: Diagnostic<ReconcileCode>[] = [...orderDiagnostics(wanted, held)];
  for (const u of moduleIncludes) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_MODULE_INCLUDED', `${unreadFrom(u, where)}${u.chain.length > 0 ? ',' : ''} #includes "${u.spelled}" (line ${u.line}), the source of module ${u.module ?? ''}, which make compiles on its own: its functions would be built twice, in both objects, and the ROM would not match; remove the #include (module ${u.module ?? ''} builds that file), or merge the two modules in romlift.toml`, { path: u.from }));
  }
  if (unplaced.length > 0 && otherUnread.length > 0) {
    const files = otherUnread.map((u) => `"${u.spelled}" (line ${u.line}${u.from === wanted.path ? '' : ` of ${u.from}`})`).join(', ');
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} gains the INCLUDE_ASM of ${unplaced.join(', ')}, but it #includes ${files}, which romlift does not read as part of it (it reads a src/*.c directly under src/ that is no module's source as part of the file that includes it), so it cannot tell whether that file defines them: move the C into ${where}, or into a src/*.c directly under src/ that is no module's source and include that, or write the statements yourself`, extra));
  } else if (unplaced.length > 0 && moduleIncludes.length === 0) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} has no safe place for the INCLUDE_ASM of ${unplaced.join(', ')}: the text ends inside a comment, a literal, a directive or an unclosed #if, or the stub would go between two chunks one #if region holds; close it, or write the statements yourself (in each branch of the region)`, extra));
  }
  for (const { chunk, before, between } of insideFragment) {
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_STUB_UNPLACED', `${where} gains the INCLUDE_ASM of ${chunk.stub}, whose place in ROM order, between ${between[0]} and ${between[1]}, lies inside ${fragmentPhrase(before.via, where, before.line, before.chain)}: romlift never edits an included file, so write INCLUDE_ASM("${dir}", ${chunk.stub}); there yourself`, { path: before.via }));
  }
  for (const s of inFragment) {
    const gone = s.dir === dir ? `module ${wanted.module} no longer has ${s.name}` : `no module of romlift.toml has ${chunkFileOf(s.dir, s.name)} any more`;
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_FRAGMENT_STUB', `${fragmentPhrase(s.via ?? '', where, s.line, s.chain)}, holds INCLUDE_ASM("${s.dir}", ${s.name}); (line ${s.fragmentLine ?? s.line}), and ${gone}: romlift never edits an included file, so rename or remove it there yourself (and the C beside it)`, { path: s.via ?? '' }));
  }
  for (const s of conditional) {
    const gone = s.dir === dir ? `module ${wanted.module} no longer has ${s.name}` : `no module of romlift.toml has ${chunkFileOf(s.dir, s.name)} any more`;
    diagnostics.push(diagnostic(ReconcileCodes, 'E_C_CONDITIONAL_STUB', `${where} holds INCLUDE_ASM("${s.dir}", ${s.name}); (line ${s.line}) inside an #if region, and ${gone}: romlift never edits conditional code, so rename or remove it there yourself (and the C beside it)`, extra));
  }
  for (const d of stale) diagnostics.push(staleDiagnostic(wanted, d, slots.get(d)?.[0], replacedOf(d)));
  const isStale = new Set(stale);
  return { edits: joinAtOffsets(edits, eolOf(text)), diagnostics, unplaced: [...unplaced, ...insideFragment.map((f) => f.chunk.stub)], undeclared: strangers.filter((d) => !isStale.has(d)) };
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
  // The stubs of the fragments it includes hold their chunks too (correctness-b2-1); an unwanted one is the fragment's E_C_FRAGMENT_STUB.
  const fragmentStubs = scan.statements.filter((s) => s.via !== undefined);
  const fragmentErrors = plan.diagnostics.filter((d) => d.code === 'E_C_FRAGMENT_STUB' || d.code === 'E_C_MODULE_INCLUDED');
  const included = new Set([...statements, ...fragmentStubs].filter((s) => s.dir === dir).map((s) => s.name));
  const defined = new Set(compiledDefinitions(scan).definitions.map((d) => d.name));
  const missing = wanted.chunks.some((c) => !included.has(c.stub) && !defined.has(c.name));
  const needsEdit = missing || statements.some((s) => unwantedStub(s, dir, stubs, wanted.tree)) || plan.diagnostics.some((d) => d.code === 'E_C_CONDITIONAL_STUB');
  const { where, extra } = whereOf(wanted);
  if (needsEdit) {
    const message = `${where} cannot be scanned for its INCLUDE_ASM lines, and romlift.toml needs them changed: ${scan.unscannable.map((u) => u.reason).join('; ')}; romlift edits nothing in it: make the branches of the conditional agree (or move it inside the function), or close the definition, or change its INCLUDE_ASM lines yourself`;
    return { edits: [], diagnostics: [diagnostic(ReconcileCodes, 'E_C_UNSCANNABLE', message, extra), ...fragmentErrors], unplaced: [], undeclared: [] };
  }
  const retired = new Set(wanted.retired ?? []);
  const stale = scan.definitions.filter((d) => retired.has(d.name));
  const diagnostics = [
    unscannableWarning(where, wanted.path, scan.unscannable, 'its INCLUDE_ASM lines already match romlift.toml as far as it reads, so nothing is edited'),
    ...plan.diagnostics.filter((d) => d.severity !== 'error'),
    ...fragmentErrors,
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
