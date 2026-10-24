// planIncludeAsm (architecture §6.3 `c-stub`, §6.6, roadmap 4.C) over the file-scope INCLUDE_ASM statements,
// function definitions and other code scanC finds (its own tests are c-scan.test.ts): the phase-4 planner adds each
// missing stub at its ROM-order position (the empty-file case included), removes a stub of the module's directory whose function is no
// longer wanted (a rename, a deletion, a move to another module: D75 b), counts a defined function as held, never
// touches a comment, string or directive, and raises W_C_ORDER when the file's order is not ROM order. Fix round 2
// (D77 a to c): a stub never goes inside a preprocessor conditional (the NONMATCHING pattern), a leading byte order
// mark is no code and stays first, a name with no safe place is E_C_STUB_UNPLACED, and the C of a renamed function
// where its new stub goes is E_C_STALE_DEFINITION.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compiledDefinitions, scanC } from '../../../src/core/reconcile/c-scan.ts';
import { planIncludeAsm } from '../../../src/core/reconcile/include-asm.ts';
import type { IncludeAsmWanted } from '../../../src/core/reconcile/include-asm.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';
import { C_STUB_HEADER, includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';

/** Chunks whose symbol is their stub name (no case-folded group). */
function same(names: readonly string[]): IncludeAsmWanted['chunks'] {
  return names.map((name) => ({ name, stub: name }));
}

const WANTED: IncludeAsmWanted = { module: 'main', chunks: same(['A', 'B', 'C', 'D']), path: 'src/main.c' };

function stub(name: string, module = 'main'): string {
  return includeAsmStatement(module, name);
}

function planned(text: string, wanted: IncludeAsmWanted = WANTED): string {
  return applyTextEdits(text, planIncludeAsm(text, wanted).edits);
}

test('the empty file and the template header: one stub per wanted function, in ROM order, each on its own line', () => {
  // A file with no stub and no include of the header gains it with its first stub (fix round 6, correctness-b1-2).
  assert.equal(planned(''), `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned(C_STUB_HEADER), `#include "include_asm.h"\n\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned('int x;'), `${C_STUB_HEADER}int x;\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`, 'a last line without its newline');
  assert.deepEqual(planIncludeAsm('', { module: 'main', chunks: same([]) }).edits, []);
  assert.ok(planIncludeAsm(C_STUB_HEADER, WANTED).edits.every((e) => e.reason === 'add-stub' && e.start === e.end));
  // The header's insertion is 'add-header' (architecture-b2-10); at one offset with the stubs, the joined edit keeps the first reason.
  assert.deepEqual(planIncludeAsm('', WANTED).edits.map((e) => [e.reason, e.start, e.end]), [['add-header', 0, 0]]);
  assert.deepEqual(planIncludeAsm('int x;\n', WANTED).edits.map((e) => e.reason), ['add-header', 'add-stub']);
});

test('a missing stub goes after the nearest earlier held function, else before the nearest later one', () => {
  const text = `${C_STUB_HEADER}${stub('B')} // keep\n\n/* about D */\nvoid D(void) {\n}\n`;
  assert.equal(planned(text), `${C_STUB_HEADER}${stub('A')}\n${stub('B')} // keep\n${stub('C')}\n\n/* about D */\nvoid D(void) {\n}\n`);
});

test('stubs before the first held function go above the comments that lead into it', () => {
  const text = `${C_STUB_HEADER}// C is decompiled\n/* and documented */\nvoid C(void) { }\n`;
  assert.equal(planned(text), `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n// C is decompiled\n/* and documented */\nvoid C(void) { }\n${stub('D')}\n`);
});

test('a function the file defines is held: no stub for it, and a decompiled file needs nothing', () => {
  const text = `${C_STUB_HEADER}void A(void) { }\n${stub('B')}\nint C(int x) { return x; }\n${stub('D')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.diagnostics, []);
});

test('stubs of another module do not hold a function of this one; they are left alone', () => {
  const text = `${stub('A', 'other')}\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A']) }), `${stub('A', 'other')}\n${stub('A')}\n`);
});

test('W_C_ORDER when the held functions are out of ROM order; the planner still only inserts', () => {
  const text = `${stub('C')}\n${stub('A')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path, d.message]), [['W_C_ORDER', 'warning', 'src/main.c', 'src/main.c holds C before A, which comes first in ROM order']]);
  assert.equal(applyTextEdits(text, plan.edits), `${stub('C')}\n${stub('D')}\n${stub('A')}\n${stub('B')}\n`);
  assert.deepEqual(planIncludeAsm(`${stub('A')}\n${stub('C')}\n`, WANTED).diagnostics, [], 'in order');
  const unnamed = planIncludeAsm(text, { module: 'main', chunks: same(['A', 'C']) }).diagnostics[0];
  assert.equal(unnamed?.path, undefined);
  assert.match(unnamed?.message ?? '', /^the C file of module main holds C before A/);
});

test('comments, strings and directives are never edited, whatever they hold', () => {
  const text = `#include "include_asm.h" /* ${stub('A')} */\nconst char *s = "${stub('B').replace(/"/g, '\\"')}";\n// ${stub('C')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  for (const e of plan.edits) assert.equal(e.start, text.length, 'only the end of the file is free of tokens here');
  assert.ok(planned(text).startsWith(text));
});

test('a file that ends inside a comment gets no stub at its end: the names are unplaced', () => {
  const text = `${stub('A')}\n/* open`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.unplaced, []);
  assert.equal(applyTextEdits(text, plan.edits), `${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n/* open`);
  assert.deepEqual(planIncludeAsm('/* open', WANTED).unplaced, ['A', 'B', 'C', 'D']);
  assert.deepEqual(planIncludeAsm('/* open', WANTED).edits, []);
  assert.deepEqual(plan.diagnostics, []);
  const refused = planIncludeAsm('/* open', WANTED).diagnostics;
  assert.deepEqual(refused.map((d) => [d.code, d.severity, d.path]), [['E_C_STUB_UNPLACED', 'error', 'src/main.c']]);
  assert.match(refused[0]?.message ?? '', /INCLUDE_ASM of A, B, C, D/);
});

test('a stub that follows code on the same line goes on a line of its own', () => {
  assert.equal(planned(`${stub('A')} int x;`, { module: 'main', chunks: same(['A', 'B']) }), `${stub('A')} \n${stub('B')}\nint x;`);
});

test('a stub whose function is no longer wanted is removed with its line; a rename is a removal and an insertion', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n${stub('Old')}\n${stub('C')}\n${stub('Gone')}\n`;
  const plan = planIncludeAsm(text, { module: 'main', chunks: same(['A', 'New', 'C']) });
  assert.deepEqual(plan.edits.map((e) => e.reason), ['add-stub', 'remove-stub', 'remove-stub']);
  assert.equal(applyTextEdits(text, plan.edits), `${C_STUB_HEADER}${stub('A')}\n${stub('New')}\n${stub('C')}\n`);
});

test('a module split or moved: the stubs of the functions that left are removed, those of another directory kept', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('X', 'other')}\n${stub('C')}\n${stub('D')}`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A', 'B']) }), `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('X', 'other')}\n`);
  assert.equal(planned(`${C_STUB_HEADER}${stub('A')}\n`, { module: 'main', chunks: same([]) }), C_STUB_HEADER, 'every function gone');
});

test('a removed stub that shares its line keeps the rest of the line; comments and definitions are never removed', () => {
  const text = `${C_STUB_HEADER}${stub('Old')} // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A']) }), `${C_STUB_HEADER} // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n${stub('A')}\n`);
});

test('an insertion at the start of a removed line goes before the removal; the CRLF line ending goes with it', () => {
  const text = `${stub('A')}\r\n${stub('Old')}\r\n${stub('C')}\r\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A', 'B', 'C']) }), `${stub('A')}\r\n${stub('B')}\r\n${stub('C')}\r\n`);
});

test('in a CRLF file every insertion ends its lines with CRLF: between stubs, at the end, after a last line without one, and the header (fix round 6, correctness-b1-5)', () => {
  const crlf = (t: string): string => t.split('\n').join('\r\n');
  const text = crlf(`${C_STUB_HEADER}${stub('A')}\n${stub('C')}\n`);
  assert.equal(planned(text, { module: 'main', chunks: same(['A', 'B', 'C', 'D']) }), crlf(`${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`));
  const unterminated = `${crlf(C_STUB_HEADER)}${stub('A')}`;
  assert.equal(planned(unterminated, { module: 'main', chunks: same(['A', 'B', 'C']) }), crlf(`${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n`));
  assert.equal(planned('void A(void) {\r\n}\r\n', { module: 'main', chunks: same(['A', 'B']) }), crlf(`${C_STUB_HEADER}void A(void) {\n}\n${stub('B')}\n`));
  for (const result of [planned(text, { module: 'main', chunks: same(['A', 'B', 'C', 'D']) }), planned(unterminated, { module: 'main', chunks: same(['A', 'B', 'C']) })]) {
    assert.ok(!/[^\r]\n/.test(result), 'no bare LF');
  }
});

const NONMATCHING = (inner: string): string => `#ifdef NONMATCHING\nint A(int x) {\n  return x;\n}\n#else\n${stub(inner)}\n#endif\n`;

test('a stub never goes inside a conditional: after the #endif of a held item in one, before the #if of a later one', () => {
  // The decomp pattern: A's C under #ifdef NONMATCHING, its stub under #else; B's stub was renamed away.
  const text = `${C_STUB_HEADER}${NONMATCHING('A')}${stub('Old')}\n${stub('C')}\n${stub('D')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(applyTextEdits(text, plan.edits), `${C_STUB_HEADER}${NONMATCHING('A')}${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  // Nothing held before the region: the stubs go above its #if (and the comment that leads into it).
  const later = `${C_STUB_HEADER}/* A, matched one day */\n${NONMATCHING('A')}`;
  assert.equal(planned(later, { module: 'main', chunks: same(['Z', 'A']) }), `${C_STUB_HEADER}${stub('Z')}\n/* A, matched one day */\n${NONMATCHING('A')}`);
  // Nested conditionals count as one outer region.
  const nested = `#if 1\n#ifdef X\n${stub('A')}\n#endif\n#endif\n`;
  assert.equal(planned(nested, { module: 'main', chunks: same(['A', 'B']) }), `${nested}${stub('B')}\n`);
});

test('an unclosed #if leaves no safe place inside or after it: E_C_STUB_UNPLACED; before it is safe', () => {
  const before = `${stub('A')}\n#ifdef NONMATCHING\n`;
  assert.equal(planned(before, { module: 'main', chunks: same(['A', 'B']) }), `${stub('A')}\n${stub('B')}\n#ifdef NONMATCHING\n`, 'after a held item at depth 0');
  const inside = `#ifdef NONMATCHING\n${stub('A')}\n`;
  const plan = planIncludeAsm(inside, { module: 'main', chunks: same(['A', 'B']), path: 'src/main.c' });
  assert.deepEqual(plan.unplaced, ['B']);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.diagnostics.map((d) => d.code), ['E_C_STUB_UNPLACED']);
  assert.deepEqual(planIncludeAsm('#if 0\n', { module: 'main', chunks: same(['A']) }).unplaced, ['A'], 'nothing held: not at the end either');
  assert.deepEqual(planIncludeAsm(inside, { module: 'main', chunks: same(['Z', 'A']) }).edits.map((e) => e.start), [0], 'before the #if is safe');
});

test('a leading byte order mark is no code: the file is read as without it, and stays first', () => {
  const BOM = '\uFEFF';
  const text = `${BOM}${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(text, WANTED).edits, [], 'nothing to add: the first stub is recognised');
  assert.equal(scanC(text).directives[0]?.kind, 'preprocessor', 'the #include after the mark is a directive');
  assert.equal(planned(`${BOM}${stub('B')}\n`, WANTED), `${BOM}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned(`${BOM}${stub('Old')}\n`, { module: 'main', chunks: same([]) }), BOM, 'a removal keeps the mark');
});

test('the C of a renamed function where its new stub goes is E_C_STALE_DEFINITION; other unwanted definitions are returned', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\nint sub_08000100(int x) {\n  return x;\n}\n${stub('C')}\n${stub('D')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path]), [['E_C_STALE_DEFINITION', 'error', 'src/main.c']]);
  assert.match(plan.diagnostics[0]?.message ?? '', /defines sub_08000100 \(line 4\), which module main no longer has, where the INCLUDE_ASM of B goes/);
  assert.deepEqual(plan.undeclared, []);
  // An unwanted definition no missing stub lands next to is not stale; the caller gets it.
  const helper = `${C_STUB_HEADER}static int Helper(void) { return 1; }\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`;
  const kept = planIncludeAsm(helper, WANTED);
  assert.deepEqual(kept.diagnostics, []);
  assert.deepEqual(kept.undeclared.map((d) => d.name), ['Helper']);
  // Writing the new name's stub by hand holds it: nothing is inserted, nothing refused.
  const byHand = `${C_STUB_HEADER}${stub('A')}\nint Helper(void) { return 1; }\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(byHand, WANTED).diagnostics, []);
});

test('the last stub of a shared line goes with the blanks before it; the stub that follows it gets a line of its own', () => {
  const text = `${stub('A')} ${stub('Old')}\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A', 'C']) }), `${stub('A')}\n${stub('C')}\n`);
});

// Fix round 3 (D78 a): conditional code is never edited, a definition inside a conditional holds nothing, the previous
// tree tells a renamed function's C from a helper, and a chunk is matched by its symbol and its stub name apart.

test('the NONMATCHING pattern after a rename: the #else stub is never removed (E_C_CONDITIONAL_STUB) until renamed by hand', () => {
  const block = (def: string, inner: string): string => `#ifdef NONMATCHING\nvoid ${def}(void) {\n}\n#else\n${stub(inner)}\n#endif\n`;
  const wanted: IncludeAsmWanted = { module: 'main', chunks: same(['A', 'Nop', 'C']), path: 'src/main.c', retired: ['sub_08000100'] };
  // The C function renamed as E_C_STALE_DEFINITION advised, the #else stub not: nothing in the block is edited.
  const half = `${C_STUB_HEADER}${stub('A')}\n${block('Nop', 'sub_08000100')}${stub('C')}\n`;
  const refused = planIncludeAsm(half, wanted);
  assert.deepEqual(refused.diagnostics.map((d) => [d.code, d.severity]), [['E_C_CONDITIONAL_STUB', 'error']]);
  assert.match(refused.diagnostics[0]?.message ?? '', /holds INCLUDE_ASM\("asm\/nonmatchings\/main", sub_08000100\); \(line 8\) inside an #if region/);
  assert.deepEqual(refused.edits.map((e) => [e.reason, e.text]), [['add-stub', `${stub('Nop')}\n`]], 'no removal; Nop, defined only inside the region, gets a stub outside it');
  // Both renamed: the #else stub holds Nop, nothing to do.
  const done = `${C_STUB_HEADER}${stub('A')}\n${block('Nop', 'Nop')}${stub('C')}\n`;
  assert.deepEqual(planIncludeAsm(done, wanted), { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: [] });
  // Neither renamed: the stale C and the conditional stub are both refused.
  const before = `${C_STUB_HEADER}${stub('A')}\n${block('sub_08000100', 'sub_08000100')}${stub('C')}\n`;
  assert.deepEqual(planIncludeAsm(before, wanted).diagnostics.map((d) => d.code), ['E_C_CONDITIONAL_STUB', 'E_C_STALE_DEFINITION']);
});

test('a definition inside a conditional does not hold its chunk: its stub goes outside the region', () => {
  const text = `${stub('A')}\n#ifdef NONMATCHING\nvoid B(void) {\n}\n#endif\n${stub('C')}\n${stub('D')}\n`;
  assert.equal(planned(text), `${stub('A')}\n${stub('B')}\n#ifdef NONMATCHING\nvoid B(void) {\n}\n#endif\n${stub('C')}\n${stub('D')}\n`);
});

test('with the previous tree known, a helper where a renamed asm-only function goes raises nothing; the C of a previous function is stale anywhere', () => {
  const helper = `${C_STUB_HEADER}${stub('A')}\nstatic inline int Helper(int a) {\n    return a + 1;\n}\n${stub('Old')}\n${stub('C')}\n${stub('D')}\n`;
  const renamed: IncludeAsmWanted = { module: 'main', chunks: same(['A', 'B', 'C', 'D']), path: 'src/main.c', retired: ['Old'] };
  const plan = planIncludeAsm(helper, renamed);
  assert.deepEqual(plan.diagnostics, [], 'Helper was no function of the previous tree');
  assert.equal(applyTextEdits(helper, plan.edits), helper.replace(`${stub('Old')}\n`, '').replace(`${stub('A')}\n`, `${stub('A')}\n${stub('B')}\n`));
  assert.deepEqual(plan.undeclared.map((d) => d.name), ['Helper']);
  // Without the previous tree the same file is refused, as before (correctness-a0-1's rule).
  assert.deepEqual(planIncludeAsm(helper, { module: renamed.module, chunks: renamed.chunks, path: 'src/main.c' }).diagnostics.map((d) => d.code), ['E_C_STALE_DEFINITION']);
  // A decompiled previous function no missing stub lands next to (its function moved away under a new name).
  const moved = `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\nvoid Old(void) {\n}\n`;
  const stale = planIncludeAsm(moved, renamed);
  assert.deepEqual(stale.diagnostics.map((d) => [d.code, d.severity]), [['E_C_STALE_DEFINITION', 'error']]);
  assert.match(stale.diagnostics[0]?.message ?? '', /defines Old \(line 7\), a function of the tree romlift last generated that romlift.toml no longer has; a function it renamed/);
  assert.deepEqual(planIncludeAsm(moved, { ...renamed, retired: [] }).diagnostics, [], 'Old is no previous function');
});

test('a case-folded pair: a definition holds its chunk by symbol, a stub by stub name, and the stub is inserted by stub name', () => {
  const chunks = [{ name: 'Foo', stub: 'Foo_080000F6' }, { name: 'foo', stub: 'foo_08000100' }];
  const decompiled = `${C_STUB_HEADER}void Foo(void) {\n}\n${stub('foo_08000100')}\n`;
  assert.deepEqual(planIncludeAsm(decompiled, { module: 'main', chunks, path: 'src/main.c' }), { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: [] });
  assert.equal(planned(C_STUB_HEADER, { module: 'main', chunks }), `${C_STUB_HEADER}${stub('Foo_080000F6')}\n${stub('foo_08000100')}\n`);
  assert.equal(planned(`${C_STUB_HEADER}${stub('Foo')}\n`, { module: 'main', chunks }), `${C_STUB_HEADER}${stub('Foo_080000F6')}\n${stub('foo_08000100')}\n`, 'a stub of the symbol is not the chunk file\'s');
});

// Fix round 4 (D80 a): a rename in C only, a conditional whose branches open braces differently, a split inside an #if
// region, and the heads the scanner names or refuses.

test('a C-only rename of a decompiled function where its stub was is E_C_STALE_DEFINITION; a helper beside a new name is not', () => {
  // The previous tree held B's file in this module's directory; the file defines Nop where B's INCLUDE_ASM was.
  const text = `${C_STUB_HEADER}${stub('A')}\nvoid Nop(void) {\n}\n${stub('C')}\n${stub('D')}\n`;
  const tree: IncludeAsmWanted = { ...WANTED, retired: [], previousStubs: ['A', 'B', 'C', 'D'] };
  const plan = planIncludeAsm(text, tree);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path]), [['E_C_STALE_DEFINITION', 'error', 'src/main.c']]);
  assert.match(plan.diagnostics[0]?.message ?? '', /defines Nop \(line 4\) where the INCLUDE_ASM of B was, and module main still has B, which the file now neither includes nor defines/);
  assert.deepEqual(plan.undeclared, []);
  // B is new to the tree (a TOML rename of an asm-only function): Nop is a helper, B's stub goes beside it.
  const helper = planIncludeAsm(text, { ...WANTED, retired: ['Old'], previousStubs: ['A', 'Old', 'C', 'D'] });
  assert.deepEqual(helper.diagnostics, []);
  assert.deepEqual(helper.undeclared.map((d) => d.name), ['Nop']);
  // The stub of a chunk of another module's directory (a border move) is not this file's to have held.
  assert.deepEqual(planIncludeAsm(text, { ...WANTED, retired: [], previousStubs: ['A', 'C', 'D'] }).diagnostics, []);
});

test('a conditional inside a body is read as the preprocessor reads it: branches that open braces differently scan (fix round 5)', () => {
  // The review's shape of fix round 4: each branch opens one brace, closed once after #endif.
  const body = 'void B(void) {\n    volatile int x = 0;\n#ifdef NONMATCHING\n    if (x) {\n#else\n    if (!x) {\n#endif\n    }\n}\n';
  const text = `${C_STUB_HEADER}${stub('A')}\n${body}${stub('C')}\n${stub('D')}\n`;
  const scan = scanC(text);
  assert.deepEqual(scan.unscannable, []);
  assert.deepEqual(scan.definitions.map((d) => d.name), ['B']);
  assert.deepEqual(scan.statements.map((d) => d.name), ['A', 'C', 'D']);
  assert.deepEqual(planIncludeAsm(text, WANTED), { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: [] });
  // The matching idiom of correctness-b0-1: `do {` and `} while (0);` each behind #ifndef NONMATCHING.
  const doWhile = `${stub('A')}\nvoid B(char *d, const char *s) {\n#ifndef NONMATCHING\n    do {\n#endif\n    while ((*d++ = *s++)) ;\n#ifndef NONMATCHING\n    } while (0);\n#endif\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(scanC(doWhile).unscannable, []);
  assert.deepEqual(planIncludeAsm(doWhile, WANTED).diagnostics, []);
  assert.equal(planned(doWhile, { ...WANTED, chunks: same(['A', 'B', 'C', 'X', 'D']) }), doWhile.replace(`${stub('C')}\n`, `${stub('C')}\n${stub('X')}\n`), 'a new stub still goes in ROM order');
  // tmc's per-version branches: each opens `if (…) {`, closed once.
  const perVersion = `${stub('A')}\nvoid B(void) {\n#if defined(EU) || defined(JP)\n    if (gSave.a) {\n#elif defined(USA)\n    if (gSave.b) {\n#else\n    if (gSave.c) {\n#endif\n        f();\n    }\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(scanC(perVersion).unscannable, []);
  assert.deepEqual(planIncludeAsm(perVersion, WANTED).diagnostics, []);
  // sa2's screen_mask.c shape: `if (…) { do {` in one branch, `for (…) {` in the other, closed the same way.
  const screenMask = [
    'void A(void) {',
    '    int i;',
    '#ifdef BUG_FIX',
    '    if (i < 160) { do {',
    '#else',
    '    for (i = 0; i < 160; i++) {',
    '#endif',
    '        i++;',
    '#ifdef BUG_FIX',
    '    } while (++i < 160); }',
    '#else',
    '    }',
    '#endif',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(planIncludeAsm(`${screenMask}${stub('B')}\n${stub('C')}\n${stub('D')}\n`, WANTED).diagnostics, []);
  // sa2's light_bridge.c shape: a head with a register pin in one branch, the plain head in the other.
  const pinned = `${stub('A')}\n#ifndef NON_MATCHING\nstatic void B(int *in)\n{\n    register int *p asm("r5") = in;\n#else\nstatic void B(int *p)\n{\n#endif\n    *p = 0;\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(scanC(pinned).unscannable, []);
  assert.deepEqual(compiledDefinitions(scanC(pinned)).definitions.map((d) => d.name), ['B'], 'compiled: its body runs past the #endif');
  assert.deepEqual(planIncludeAsm(pinned, WANTED).diagnostics, []);
  assert.equal(planned(pinned, { ...WANTED, chunks: same(['A', 'B', 'X', 'C', 'D']) }), pinned.replace(`}\n${stub('C')}`, `}\n${stub('X')}\n${stub('C')}`), 'the stub after it goes after its body, not after the #endif');
});

test('an unscannable file is E_C_UNSCANNABLE only when it needs an edit; otherwise W_C_UNSCANNABLE and no edit (fix round 5)', () => {
  // A file-scope conditional whose branches end with different unfinished heads: an ASM_FUNC with no `;` against a definition.
  const ambiguous = `#ifdef VC\nASM_FUNC("asm/b.s", void B(void))\n#else\nvoid B(void) {\n}\n#endif\n`;
  const text = `${stub('A')}\n${ambiguous}${stub('C')}\n${stub('D')}\n`;
  assert.match(scanC(text).unscannable[0]?.reason ?? '', /the branches of the conditional on line 2 end \(line 7\)/);
  // A chunk the module gained needs a stub the planner cannot place in a file it cannot split.
  const needs = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B', 'C', 'D', 'E']) });
  assert.deepEqual(needs.edits, []);
  assert.deepEqual(needs.diagnostics.map((d) => [d.code, d.severity]), [['E_C_UNSCANNABLE', 'error']]);
  // An unwanted stub swallowed by an unclosed definition is still seen: the file needs its removal.
  const swallowed = `${stub('A')}\nvoid B(void) {\n${stub('Gone')}\n`;
  assert.deepEqual(planIncludeAsm(swallowed, { ...WANTED, chunks: same(['A']) }).diagnostics.map((d) => d.code), ['E_C_UNSCANNABLE']);
  // The same file whose stubs and definitions already match: a warning, nothing edited.
  const kept = `${stub('A')}\n${ambiguous}\n${stub('C')}\n${stub('D')}\n`;
  const plan = planIncludeAsm(kept, { ...WANTED, chunks: same(['A', 'C', 'D']) });
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path]), [['W_C_UNSCANNABLE', 'warning', 'src/main.c']]);
});

test('a stub of a directory the tree no longer writes is removed; a user module\'s and a live chunk\'s are kept (fix round 5)', () => {
  const tree = { files: new Set(['asm/nonmatchings/boot/A.s', 'asm/nonmatchings/boot/B.s', 'asm/nonmatchings/other/X.s']), userDirs: new Set(['asm/nonmatchings/mine']) };
  const wanted: IncludeAsmWanted = { module: 'boot', chunks: same(['A', 'B']), path: 'src/boot.c', tree };
  // `git mv src/agbmain.c src/boot.c` after renaming module agbmain to boot.
  const moved = `${C_STUB_HEADER}${stub('A', 'agbmain')}\n${stub('B', 'agbmain')}\n`;
  assert.equal(planned(moved, wanted), `${C_STUB_HEADER}${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  // With decompiled C between them: the new stubs go around it in ROM order.
  const decompiled = `${C_STUB_HEADER}${stub('A', 'agbmain')}\nvoid B(void) {\n}\n${stub('C', 'agbmain')}\n`;
  const three: IncludeAsmWanted = { ...wanted, chunks: same(['A', 'B', 'C']), tree: { ...tree, files: new Set([...tree.files, 'asm/nonmatchings/boot/C.s']) } };
  assert.equal(planned(decompiled, three), `${C_STUB_HEADER}${stub('A', 'boot')}\nvoid B(void) {\n}\n${stub('C', 'boot')}\n`);
  // Every stub replaced in a file that does not include the header itself (a fragment made a module's source, whose
  // stubs compiled under the including file's header, correctness-c0-1): the header comes with the new stubs, whatever
  // other #include or #define the file has (a global.h for its types; fix round 9, correctness-c1-1, architecture-c1-1).
  const bare = `${stub('A', 'agbmain')}\n${stub('B', 'agbmain')}\n`;
  assert.equal(planned(bare, wanted), `${C_STUB_HEADER}${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  assert.equal(planned(`#include "global.h"\n${bare}`, wanted), `${C_STUB_HEADER}#include "global.h"\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  assert.equal(planned(`#define UNUSED 1\n${bare}`, wanted), `${C_STUB_HEADER}#define UNUSED 1\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  // A file that includes the header itself, or defines the macro itself, gains none.
  assert.equal(planned(`#include "global.h"\n#include "include_asm.h"\n${bare}`, wanted), `#include "global.h"\n#include "include_asm.h"\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  const own = '#define INCLUDE_ASM(DIR, NAME) asm("")\n';
  assert.equal(planned(`${own}${bare}`, wanted), `${own}${stub('A', 'boot')}\n${stub('B', 'boot')}\n`);
  // Kept: another live module's chunk, a user module's directory, a directory outside asm/nonmatchings.
  const others = `${stub('A', 'boot')}\n${stub('B', 'boot')}\n${stub('X', 'other')}\n${stub('Y', 'mine')}\nINCLUDE_ASM("asm/custom", Z);\n`;
  assert.deepEqual(planIncludeAsm(others, wanted).edits, []);
  // Inside a region it is E_C_CONDITIONAL_STUB, never edited.
  const region = `${stub('A', 'boot')}\n#ifdef NONMATCHING\n#else\n${stub('B', 'agbmain')}\n#endif\n`;
  const refused = planIncludeAsm(region, wanted);
  assert.deepEqual(refused.diagnostics.map((d) => d.code), ['E_C_CONDITIONAL_STUB']);
  assert.match(refused.diagnostics[0]?.message ?? '', /no module of romlift\.toml has asm\/nonmatchings\/agbmain\/B\.s any more/);
  // Without a tree (the planner alone), another directory's stubs are left alone, as before.
  assert.deepEqual(planIncludeAsm(moved, { module: 'boot', chunks: same(['A', 'B']) }).edits.filter((e) => e.reason === 'remove-stub'), []);
});

test('a renamed module whose file gets INCLUDE_ASM from its own global.h gains no second header; one whose global.h only declares types does (fix round 10, correctness-c2-1)', () => {
  const tree = { files: new Set(['asm/nonmatchings/boot2/A.s', 'asm/nonmatchings/boot2/B.s']), userDirs: new Set<string>() };
  // The reviewer's klonoa flow: module boot renamed boot2 in romlift.toml, `git mv src/boot.c src/boot2.c`.
  const base: IncludeAsmWanted = { module: 'boot2', chunks: same(['A', 'B']), path: 'src/boot2.c', tree };
  const text = `#include "global.h"\n${stub('A', 'boot')}\nvoid B(void) {\n}\n`;
  const renamed = `#include "global.h"\n${stub('A', 'boot2')}\nvoid B(void) {\n}\n`;
  const defining = '#ifndef GUARD_GLOBAL_H\n#define GUARD_GLOBAL_H\n#define INCLUDE_ASM(DIR, NAME) asm(".include \\"" DIR "/" #NAME ".s\\"")\nasm(".include \\"include/macros.inc\\"\\n");\n#endif\n';
  // global.h defines the macro and includes macros.inc itself: the header would include macros.inc a second time.
  assert.equal(planned(text, { ...base, headers: new Map([['include/global.h', defining]]) }), renamed);
  // Through a nested header, from the header's own directory or from include/, and through include_asm.h by name.
  const nested = new Map([['include/global.h', '#include "gba/gba.h"\n'], ['include/gba/gba.h', '#include "macro.h"\n'], ['include/gba/macro.h', defining]]);
  assert.equal(planned(text, { ...base, headers: nested }), renamed);
  const rooted = new Map([['include/global.h', '#include "gba/gba.h"\n'], ['include/gba/gba.h', '#include "macro.h"\n'], ['include/macro.h', defining]]);
  assert.equal(planned(text, { ...base, headers: rooted }), renamed);
  assert.equal(planned(text, { ...base, headers: new Map([['include/global.h', '#include "include_asm.h"\n']]) }), renamed);
  // A global.h that only declares types, or includes headers in a cycle none of which defines it: the header comes.
  const types = new Map([['include/global.h', '#include "types.h"\ntypedef int s32;\n'], ['include/types.h', '#include "global.h"\n']]);
  assert.equal(planned(text, { ...base, headers: types }), `${C_STUB_HEADER}${renamed}`);
  // An include that resolves to no header read (above include/, or absent), and no headers at all: the header comes.
  assert.equal(planned(text.replace('global.h', '../src/global.h'), { ...base, headers: new Map([['include/global.h', defining]]) }), `${C_STUB_HEADER}${renamed.replace('global.h', '../src/global.h')}`);
  assert.equal(planned(text, base), `${C_STUB_HEADER}${renamed}`);
  // The fragment made a module (fix round 9's case, correctness-c1-1) keeps its rule: types.h defines nothing.
  const fragment = `#include "types.h"\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`;
  assert.equal(planned(fragment, { ...base, headers: new Map([['include/types.h', 'typedef int s32;\n']]) }), `${C_STUB_HEADER}#include "types.h"\n${stub('A', 'boot2')}\n${stub('B', 'boot2')}\n`);
});

test('the macro reached through a src/*.c fragment the file includes, an angle include or a src/*.h: no second header (fix round 11, correctness-d0-1, d0-2)', () => {
  const tree = { files: new Set(['asm/nonmatchings/boot2/A.s', 'asm/nonmatchings/boot2/B.s']), userDirs: new Set<string>() };
  const base: IncludeAsmWanted = { module: 'boot2', chunks: same(['A', 'B']), path: 'src/boot2.c', tree };
  const defining = '#ifndef GUARD_GLOBAL_H\n#define GUARD_GLOBAL_H\n#define INCLUDE_ASM(DIR, NAME) asm(".include \\"" DIR "/" #NAME ".s\\"")\nasm(".include \\"include/macros.inc\\"\\n");\n#endif\n';
  const types = 'typedef int s32;\n';
  const kinds = (text: string, wanted: IncludeAsmWanted): string[] => {
    const plan = planIncludeAsm(text, wanted);
    assert.deepEqual(plan.diagnostics, []);
    return plan.edits.map((e) => e.reason);
  };
  // The reviewers' flow: src/boot2.c includes the fragment src/part.c, which includes the defining global.h.
  const viaPart = `#include "part.c"\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`;
  const renamed = `#include "part.c"\n${stub('A', 'boot2')}\n${stub('B', 'boot2')}\n`;
  const part = (text: string): ReadonlyMap<string, string> => new Map([['src/part.c', text]]);
  assert.equal(planned(viaPart, { ...base, fragments: part('#include "global.h"\n'), headers: new Map([['include/global.h', defining]]) }), renamed);
  assert.deepEqual(kinds(viaPart, { ...base, fragments: part('#include "global.h"\n'), headers: new Map([['include/global.h', defining]]) }), ['remove-stub', 'remove-stub', 'add-stub'], 'no add-header, no diagnostic');
  // Two fragments deep, an angle include in the fragment, the fragment defining the macro, or including include_asm.h.
  const deep = new Map([['src/part.c', '#include "deeper.c"\n'], ['src/deeper.c', '#include "global.h"\nvoid Z(void) {}\n']]);
  assert.equal(planned(viaPart, { ...base, fragments: deep, headers: new Map([['include/global.h', defining]]) }), renamed);
  assert.equal(planned(viaPart, { ...base, fragments: part('#include <global.h>\n'), headers: new Map([['include/global.h', defining]]) }), renamed);
  assert.equal(planned(viaPart, { ...base, fragments: part('#define INCLUDE_ASM(DIR, NAME)\n') }), renamed);
  assert.equal(planned(viaPart, { ...base, fragments: part('#include "include_asm.h"\n') }), renamed);
  // A fragment whose global.h only declares types: the header comes.
  assert.equal(planned(viaPart, { ...base, fragments: part('#include "global.h"\n'), headers: new Map([['include/global.h', types]]) }), `${C_STUB_HEADER}${renamed}`);
  // The angle include of include/global.h, as cpp -nostdinc -I include resolves it; <include_asm.h> by its path.
  const angle = `#include <global.h>\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`;
  const angleRenamed = `#include <global.h>\n${stub('A', 'boot2')}\n${stub('B', 'boot2')}\n`;
  assert.equal(planned(angle, { ...base, headers: new Map([['include/global.h', defining]]) }), angleRenamed);
  assert.equal(planned(angle, { ...base, headers: new Map([['include/global.h', '#include <gba/macro.h>\n'], ['include/gba/macro.h', defining]]) }), angleRenamed);
  assert.equal(planned(angle.replace('<global.h>', '<include_asm.h>'), base), angleRenamed.replace('<global.h>', '<include_asm.h>'));
  // An angle include never searches the file's own directory: a src/global.h that defines the macro is not it.
  assert.equal(planned(angle, { ...base, headers: new Map([['src/global.h', defining]]) }), `${C_STUB_HEADER}${angleRenamed}`);
  // A quoted include searches the file's own directory first: src/local.h, and src/global.h before include/global.h.
  const quoted = (name: string): string => `#include "${name}"\n${stub('A', 'boot')}\n${stub('B', 'boot')}\n`;
  const quotedRenamed = (name: string): string => `#include "${name}"\n${stub('A', 'boot2')}\n${stub('B', 'boot2')}\n`;
  assert.equal(planned(quoted('local.h'), { ...base, headers: new Map([['src/local.h', defining]]) }), quotedRenamed('local.h'));
  assert.equal(planned(quoted('global.h'), { ...base, headers: new Map([['src/global.h', types], ['include/global.h', defining]]) }), `${C_STUB_HEADER}${quotedRenamed('global.h')}`);
  assert.equal(planned(quoted('global.h'), { ...base, headers: new Map([['src/global.h', defining], ['include/global.h', types]]) }), quotedRenamed('global.h'));
});

test('a split of the first of two stubs one #if region holds is E_C_STUB_UNPLACED: the stub is never put behind the later one', () => {
  const text = `${stub('A')}\n#ifdef NONMATCHING\n#else\n${stub('B')}\n${stub('D')}\n#endif\n${stub('E')}\n`;
  const plan = planIncludeAsm(text, { module: 'main', chunks: same(['A', 'B', 'C', 'D', 'E']), path: 'src/main.c' });
  assert.deepEqual(plan.unplaced, ['C']);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity]), [['E_C_STUB_UNPLACED', 'error']]);
  assert.match(plan.diagnostics[0]?.message ?? '', /between two chunks one #if region holds/);
  // A chunk after the region's last one still goes after its #endif.
  const tail = planIncludeAsm(text, { module: 'main', chunks: same(['A', 'B', 'D', 'X', 'E']) });
  assert.deepEqual(tail.diagnostics, []);
  assert.equal(applyTextEdits(text, tail.edits), text.replace('#endif\n', `#endif\n${stub('X')}\n`));
});

test('a function returning a function pointer is held; a K&R definition is unscannable', () => {
  const fnPointer = `${stub('A')}\nvoid (*B(void))(void) {\n    return 0;\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(fnPointer, WANTED).edits, [], 'B is held: no stub inserted beside it');
  const knr = `${stub('A')}\nint B(a) int a; {\n    return a;\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(knr, WANTED).diagnostics.map((d) => d.code), ['E_C_UNSCANNABLE']);
  assert.deepEqual(planIncludeAsm(knr, WANTED).edits, []);
});

// Fix round 6 (D82): the header a file gains with its first stub, a definition in every branch, and the fragments a
// module's file includes.

test('a file of decompiled C alone gains the header with its first stub, below its leading comments; one with a stub or the include does not (correctness-b1-2)', () => {
  const two = { module: 'main', chunks: same(['A', 'B']), path: 'src/main.c' };
  assert.equal(planned('/* licence */\n// file\nvoid A(void) {\n}\n', two), `/* licence */\n// file\n${C_STUB_HEADER}void A(void) {\n}\n${stub('B')}\n`);
  assert.equal(planned('/* licence */ void A(void) {\n}\n', two), `/* licence */ \n${C_STUB_HEADER}void A(void) {\n}\n${stub('B')}\n`, 'a comment on the first code line stays whole');
  assert.equal(planned('#include "global.h"\nvoid A(void) {\n}\n', two), `${C_STUB_HEADER}#include "global.h"\nvoid A(void) {\n}\n${stub('B')}\n`);
  // The include or a stub anywhere (a stub kept: its macro is defined some way the build has): no second include.
  assert.equal(planned('#include "include_asm.h"\nvoid A(void) {\n}\n', two), `#include "include_asm.h"\nvoid A(void) {\n}\n${stub('B')}\n`);
  assert.equal(planned(`#include "global.h"\n#ifdef NONMATCHING\nvoid A(void) {\n}\n#else\n${stub('A')}\n#endif\n`, two), `#include "global.h"\n#ifdef NONMATCHING\nvoid A(void) {\n}\n#else\n${stub('A')}\n#endif\n${stub('B')}\n`);
  // Only an insertion brings it: a file that needs none, or only a removal, is left without it.
  assert.deepEqual(planIncludeAsm('void A(void) {\n}\nvoid B(void) {\n}\n', two).edits, []);
});

test('a definition in every branch of a conditional with an #else holds its chunk: no second stub (correctness-b1-4)', () => {
  const abc = { module: 'm', chunks: same(['A', 'B', 'C']), path: 'src/m.c' };
  const m = (name: string): string => stub(name, 'm');
  const naked = `${C_STUB_HEADER}${m('A')}\n#ifdef NONMATCHING\nint B(int x) {\n  return x;\n}\n#else\nNAKED int B(int x) {\n  asm(".include \\"b.s\\"");\n}\n#endif\n${m('C')}\n`;
  assert.deepEqual(planIncludeAsm(naked, abc), { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: [] });
  assert.deepEqual(compiledDefinitions(scanC(naked)).definitions.map((d) => [d.name, d.line]), [['B', 5]], 'one compiled definition, the first branch\'s');
  // Without the #else, or with B in only one branch, or in a conditional nested in the #else: no build is sure to
  // compile it, so its stub goes in, after A (outside the region).
  const variants = [
    naked.replace('#else\n', '#elif defined(OTHER)\n'),
    naked.replace('NAKED int B(int x) {\n  asm(".include \\"b.s\\"");\n}\n', 'int B(int x);\n'),
    naked.replace('#else\nNAKED int B(int x) {\n  asm(".include \\"b.s\\"");\n}\n', '#else\n#ifdef FOO\nNAKED int B(int x) {\n  asm(".include \\"b.s\\"");\n}\n#endif\n'),
  ];
  for (const text of variants) {
    const plan = planIncludeAsm(text, abc);
    assert.deepEqual(plan.diagnostics.filter((d) => d.severity === 'error'), [], text);
    assert.equal(applyTextEdits(text, plan.edits), text.replace(`${m('A')}\n`, `${m('A')}\n${m('B')}\n`), text);
  }
  // A missing chunk after one held in every branch goes after the region's #endif, never inside it.
  const split = planIncludeAsm(naked, { module: 'm', chunks: same(['A', 'B', 'X', 'C']), path: 'src/m.c' });
  assert.equal(applyTextEdits(naked, split.edits), naked.replace(`#endif\n${m('C')}`, `#endif\n${m('X')}\n${m('C')}`));
});

test('a src/*.c fragment the file #includes defines its functions there; an unread fragment refuses every insertion (correctness-b1-3)', () => {
  const def = (...names: string[]): string => names.map((n) => `void ${n}(void) {\n}\n`).join('');
  const fragments = new Map([['src/poly.inc.c', def('B')]]);
  const wanted = { ...WANTED, fragments };
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "poly.inc.c"\n${stub('C')}\n${stub('D')}\n`;
  const plan = planIncludeAsm(text, wanted);
  assert.deepEqual([plan.edits, plan.diagnostics, plan.included], [[], [], ['src/poly.inc.c']]);
  // A fragment's function the module does not want is returned for the caller (E_C_DEFINITION_MOVED there), named by its fragment.
  const other = planIncludeAsm(text, { ...wanted, fragments: new Map([['src/poly.inc.c', def('B', 'Elsewhere')]]) });
  assert.deepEqual(other.undeclared.map((d) => [d.name, d.via, d.line]), [['Elsewhere', 'src/poly.inc.c', 4]]);
  // A renamed function whose C the fragment holds is stale, wherever the include lies.
  const stale = planIncludeAsm(text, { ...wanted, fragments: new Map([['src/poly.inc.c', def('Old')]]), retired: ['Old'], previousStubs: [] });
  assert.deepEqual(stale.diagnostics.map((d) => d.code), ['E_C_STALE_DEFINITION']);
  assert.match(stale.diagnostics[0]?.message ?? '', /^src\/poly\.inc\.c, which src\/main\.c includes \(line 4\), defines Old, a function/);
  // A quoted include romlift does not read and that is no header: an insertion it might duplicate is refused.
  const unread = text.replace('#include "poly.inc.c"', '#include "poly.inc"');
  const refused = planIncludeAsm(unread, wanted);
  assert.deepEqual([refused.edits, refused.unplaced, refused.diagnostics.map((d) => d.code)], [[], ['B'], ['E_C_STUB_UNPLACED']]);
  assert.match(refused.diagnostics[0]?.message ?? '', /#includes "poly\.inc" \(line 4\), which romlift does not read/);
  // A header, an include inside an initializer, and a fragment that needs no insertion are no refusal.
  for (const harmless of [text.replace('#include "poly.inc.c"', '#include "poly.h"'), text.replace('#include "poly.inc.c"', 'const int t[] = {\n#include "table.inc"\n};')]) {
    const p = planIncludeAsm(harmless, wanted);
    assert.deepEqual(p.diagnostics, [], harmless);
    assert.equal(applyTextEdits(harmless, p.edits).includes(stub('B')), true, harmless);
  }
  assert.deepEqual(planIncludeAsm(unread.replace(stub('A'), `${stub('A')}\n${stub('B')}`), wanted).diagnostics, []);
  // Without the fragments (or the file's path) includes are not followed.
  assert.deepEqual(planIncludeAsm(text, WANTED).included, []);
});

// Fix round 7 (D83 a): a fragment's INCLUDE_ASM statements hold their chunks at the #include line; romlift never
// edits a fragment, so a stub it would have to lose, or one whose place lies inside it, is refused naming it.

test('the INCLUDE_ASM statements of an #included fragment hold their chunks: no second stub, no W_C_ORDER (correctness-b2-1)', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('D')}\n`;
  const fragments = new Map([['src/part.c', `${stub('B')}\n${stub('C')}\n`]]);
  const plan = planIncludeAsm(text, { ...WANTED, fragments });
  assert.deepEqual(plan, { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: ['src/part.c'] });
  // Without reading them (fix round 6), B and C were inserted a second time beside the include.
  assert.deepEqual(planIncludeAsm(text, { ...WANTED, fragments: new Map([['src/part.c', '']]) }).edits.length, 1);
  // A fragment that includes another holds what that one holds.
  // (Only a src/*.c directly under src/ is read, readCTexts: architecture-c0-2.)
  const nested = planIncludeAsm(text, { ...WANTED, fragments: new Map([['src/part.c', `${stub('B')}\n#include "deep.c"\n`], ['src/deep.c', `${stub('C')}\n`]]) });
  assert.deepEqual([nested.edits, nested.diagnostics, nested.included], [[], [], ['src/part.c', 'src/deep.c']]);
});

test('a refusal over a nested fragment names the file that includes it directly, then the module\'s file (fix round 8, correctness-c0-3)', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('D')}\n`;
  const fragments = new Map([['src/part.c', `// part\n${stub('B')}\n#include "deep.c"\n`], ['src/deep.c', `${stub('C')}\n`]]);
  const renamed = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B', 'C2', 'D']), fragments });
  assert.deepEqual(renamed.diagnostics.map((d) => [d.code, d.path]), [['E_C_FRAGMENT_STUB', 'src/deep.c']]);
  assert.match(renamed.diagnostics[0]?.message ?? '', /^src\/deep\.c, which src\/part\.c includes \(line 3\), which src\/main\.c includes \(line 4\), holds INCLUDE_ASM\("asm\/nonmatchings\/main", C\); \(line 1\)/);
  // A definition there of another module's function, through reconcileStubs' E_C_DEFINITION_MOVED, uses the same chain.
  const moved = planIncludeAsm(text, { ...WANTED, fragments: new Map([...fragments, ['src/deep.c', `${stub('C')}\nvoid Elsewhere(void) {\n}\n`]]) });
  assert.deepEqual(moved.undeclared.map((d) => [d.name, d.via, d.chain]), [['Elsewhere', 'src/deep.c', [{ from: 'src/main.c', line: 4 }, { from: 'src/part.c', line: 3 }]]]);
});

test('W_C_ORDER covers the chunks inside a fragment, naming it (fix round 8, architecture-c0-3)', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('D')}\n`;
  const reversed = planIncludeAsm(text, { ...WANTED, fragments: new Map([['src/part.c', `${stub('C')}\n${stub('B')}\n`]]) });
  assert.deepEqual([reversed.edits, reversed.diagnostics.map((d) => [d.code, d.path])], [[], [['W_C_ORDER', 'src/part.c']]]);
  assert.equal(reversed.diagnostics[0]?.message, 'src/part.c, which src/main.c includes (line 4), holds C before B, which comes first in ROM order');
  // Across a nested fragment: B in part.c after the include of deep.c, which holds C; both files named (fix round 9,
  // correctness-c1-3).
  const nested = planIncludeAsm(text, { ...WANTED, fragments: new Map([['src/part.c', `#include "deep.c"\n${stub('B')}\n`], ['src/deep.c', `${stub('C')}\n`]]) });
  assert.deepEqual(nested.diagnostics.map((d) => [d.code, d.path]), [['W_C_ORDER', 'src/deep.c']]);
  assert.equal(nested.diagnostics[0]?.message, 'src/main.c holds C before B, which comes first in ROM order, through its includes: C is in src/deep.c, which src/part.c includes (line 1), which src/main.c includes (line 4); B is in src/part.c, which src/main.c includes (line 4)');
  // In order, and a decompiled function in the fragment: no warning.
  const ordered = planIncludeAsm(text, { ...WANTED, fragments: new Map([['src/part.c', `void B(void) {\n}\n${stub('C')}\n`]]) });
  assert.deepEqual(ordered.diagnostics, []);
  // The fragment after a chunk the module's file holds later in ROM order: the file's own warning.
  const outside = planIncludeAsm(`${C_STUB_HEADER}${stub('A')}\n${stub('D')}\n#include "part.c"\n`, { ...WANTED, fragments: new Map([['src/part.c', `${stub('B')}\n${stub('C')}\n`]]) });
  assert.deepEqual(outside.diagnostics.map((d) => [d.code, d.path]), [['W_C_ORDER', 'src/main.c']]);
  assert.equal(outside.diagnostics[0]?.message, 'src/main.c holds D before C, which comes first in ROM order, through its includes: D is in src/main.c; C is in src/part.c, which src/main.c includes (line 5)');
});

test('a fragment\'s stub the module no longer has is E_C_FRAGMENT_STUB naming the fragment; a stub whose place lies inside it is E_C_STUB_UNPLACED (correctness-b2-1)', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('D')}\n`;
  const fragments = new Map([['src/part.c', `// part\n${stub('B')}\n${stub('C')}\n`]]);
  // B renamed B2 in the TOML: the fragment's B stub would go, and romlift edits no fragment.
  const renamed = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B2', 'C', 'D']), fragments });
  assert.deepEqual(renamed.diagnostics.map((d) => [d.code, d.path]), [['E_C_FRAGMENT_STUB', 'src/part.c']]);
  assert.equal(renamed.diagnostics[0]?.message, `src/part.c, which src/main.c includes (line 4), holds INCLUDE_ASM("asm/nonmatchings/main", B); (line 2), and module main no longer has B: romlift never edits an included file, so rename or remove it there yourself (and the C beside it)`);
  // A stub of a directory the tree no longer writes (a renamed module), and one inside an #if of the fragment, alike.
  const tree = { files: new Set(['asm/nonmatchings/main/B.s', 'asm/nonmatchings/main/C.s']), userDirs: new Set<string>() };
  const gone = planIncludeAsm(text, { ...WANTED, tree, fragments: new Map([['src/part.c', `${stub('B')}\n#ifdef X\n${stub('C')}\n#endif\n${stub('Old', 'old')}\n`]]) });
  assert.deepEqual(gone.diagnostics.map((d) => d.code), ['E_C_FRAGMENT_STUB']);
  assert.match(gone.diagnostics[0]?.message ?? '', /no module of romlift\.toml has asm\/nonmatchings\/old\/Old\.s any more/);
  // A split between B and C: the new stub's place is inside the fragment.
  const split = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B', 'X', 'C', 'D']), fragments });
  assert.deepEqual([split.edits, split.unplaced, split.diagnostics.map((d) => [d.code, d.path])], [[], ['X'], [['E_C_STUB_UNPLACED', 'src/part.c']]]);
  assert.match(split.diagnostics[0]?.message ?? '', /whose place in ROM order, between B and C, lies inside src\/part\.c, which src\/main\.c includes \(line 4\): romlift never edits an included file/);
  // Before the fragment's first chunk or after its last, the stub goes beside the include, in ROM order.
  const outside = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'X', 'B', 'C', 'Y', 'D']), fragments });
  assert.deepEqual(outside.diagnostics, []);
  assert.equal(applyTextEdits(text, outside.edits), `${C_STUB_HEADER}${stub('A')}\n${stub('X')}\n#include "part.c"\n${stub('Y')}\n${stub('D')}\n`);
  // Two decompiled functions in a fragment and a chunk split between them: refused the same way.
  const defs = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B', 'X', 'C', 'D']), fragments: new Map([['src/part.c', 'void B(void) {\n}\nvoid C(void) {\n}\n']]) });
  assert.deepEqual(defs.diagnostics.map((d) => d.code), ['E_C_STUB_UNPLACED']);
});

test('a fragment the scanner cannot split: W_C_UNSCANNABLE naming it, E_C_UNSCANNABLE when the file needs an edit (architecture-b2-4)', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('C')}\n${stub('D')}\n`;
  const fragments = new Map([['src/part.c', 'int K(a)\nint a;\n{ return a; }\nvoid B(void) {\n}\n']]);
  const warned = planIncludeAsm(text, { ...WANTED, fragments });
  assert.deepEqual([warned.edits, warned.diagnostics.map((d) => [d.code, d.path])], [[], [['W_C_UNSCANNABLE', 'src/part.c']]]);
  const refused = planIncludeAsm(text, { ...WANTED, chunks: same(['A', 'B', 'C', 'D', 'E']), fragments });
  assert.deepEqual([refused.edits, refused.diagnostics.map((d) => [d.code, d.path])], [[], [['E_C_UNSCANNABLE', 'src/part.c']]]);
  // The verdict follows what the file needs, not what was planned (fix round 8, architecture-c0-1): an insertion refused
  // by an unread include, and a module's file that is itself unscannable and needs an edit.
  const unread = planIncludeAsm(text.replace(`${stub('D')}\n`, '#include "other.inc"\n'), { ...WANTED, fragments });
  assert.deepEqual([unread.edits, unread.diagnostics.map((d) => [d.code, d.path])], [[], [['E_C_STUB_UNPLACED', 'src/main.c'], ['E_C_UNSCANNABLE', 'src/part.c']]]);
  const own = planIncludeAsm(`${text}int K2(a)\nint a;\n{ return a; }\n`, { ...WANTED, chunks: same(['A', 'B', 'C', 'D', 'E']), fragments });
  assert.deepEqual([own.edits, own.diagnostics.map((d) => [d.code, d.path])], [[], [['E_C_UNSCANNABLE', 'src/main.c'], ['E_C_UNSCANNABLE', 'src/part.c']]]);
  for (const plan of [unread, own]) assert.ok(!plan.diagnostics.some((d) => d.message.includes('needs no')), 'no warning that says the file needs no edit');
});

test('an include of another module\'s source is E_C_MODULE_INCLUDED, whether or not the file needs an edit (architecture-b2-5; fix round 8, correctness-c0-1)', () => {
  const sources = new Map([['src/main.c', 'main'], ['src/main_2.c', 'main_2']]);
  const text = `${C_STUB_HEADER}${stub('A')}\n#include "main_2.c"\n${stub('C')}\n${stub('D')}\n`;
  const plan = planIncludeAsm(text, { ...WANTED, fragments: new Map(), sources });
  assert.deepEqual([plan.edits, plan.diagnostics.map((d) => [d.code, d.path])], [[], [['E_C_MODULE_INCLUDED', 'src/main.c']]]);
  assert.equal(plan.diagnostics[0]?.message, 'src/main.c #includes "main_2.c" (line 4), the source of module main_2, which make compiles on its own: its functions would be built twice, in both objects, and the ROM would not match; remove the #include (module main_2 builds that file), or merge the two modules in romlift.toml');
  // The file needs no edit (a fragment made a module, the split the review made): refused all the same.
  const held = planIncludeAsm(text.replace('#include "main_2.c"', stub('B')), { ...WANTED, fragments: new Map(), sources });
  assert.deepEqual(held.diagnostics, []);
  const noEdit = planIncludeAsm(`${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n#include "main_2.c"\n`, { ...WANTED, fragments: new Map(), sources });
  assert.deepEqual([noEdit.edits, noEdit.diagnostics.map((d) => d.code)], [[], ['E_C_MODULE_INCLUDED']]);
  // A recorded limitation (fix round 9, correctness-c1-2): an include under a conditional is refused too, even `#if 0`.
  const dead = planIncludeAsm(`${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n#if 0\n#include "main_2.c"\n#endif\n`, { ...WANTED, fragments: new Map(), sources });
  assert.deepEqual(dead.diagnostics.map((d) => d.code), ['E_C_MODULE_INCLUDED']);
  // `sources` is read only while includes are followed, with `fragments` given (its docstring; architecture-c1-3).
  assert.deepEqual(planIncludeAsm(text, { ...WANTED, sources }).diagnostics, []);
  // From a fragment the file includes: named through it. An include of the file itself is no refusal.
  const deep = planIncludeAsm(`${C_STUB_HEADER}${stub('A')}\n#include "part.c"\n${stub('D')}\n`, { ...WANTED, fragments: new Map([['src/part.c', `${stub('B')}\n${stub('C')}\n#include "main_2.c"\n`]]), sources });
  assert.deepEqual(deep.diagnostics.map((d) => [d.code, d.path]), [['E_C_MODULE_INCLUDED', 'src/part.c']]);
  assert.match(deep.diagnostics[0]?.message ?? '', /^src\/part\.c, which src\/main\.c includes \(line 4\), #includes "main_2\.c" \(line 3\), the source of module main_2/);
  assert.deepEqual(planIncludeAsm(`${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`, { ...WANTED, fragments: new Map(), sources }).diagnostics, []);
});
