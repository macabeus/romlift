// scanC and planIncludeAsm (architecture §6.3 `c-stub`, §6.6, roadmap 4.C): file-scope INCLUDE_ASM statements,
// function definitions and other code found through the tokenizer; the phase-4 planner adds each missing stub at its
// ROM-order position (the empty-file case included), removes a stub of the module's directory whose function is no
// longer wanted (a rename, a deletion, a move to another module: D75 b), counts a defined function as held, never
// touches a comment, string or directive, and raises W_C_ORDER when the file's order is not ROM order. Fix round 2
// (D77 a to c): a stub never goes inside a preprocessor conditional (the NONMATCHING pattern), a leading byte order
// mark is no code and stays first, a name with no safe place is E_C_STUB_UNPLACED, and the C of a renamed function
// where its new stub goes is E_C_STALE_DEFINITION.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compiledDefinitions, planIncludeAsm, scanC } from '../../../src/core/reconcile/include-asm.ts';
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

test('scanC: statements, definitions, other code, directives, with offsets and lines', () => {
  const text = [
    '#include "include_asm.h"',
    '/* INCLUDE_ASM("asm/nonmatchings/main", Commented); */',
    'INCLUDE_ASM("asm/nonmatchings/main", A);',
    'INCLUDE_ASM ( /* dir */ "asm/nonmatchings/main" , B ) ;',
    'static int gCount = 0;',
    'struct S { int a; };',
    'int Sum(int a, int b) { if (a) { return a + b; } return b; }',
    'void Proto(void);',
    'const int gTable[2] = { 1, 2 };',
    'INCLUDE_ASM("asm/nonmatchings/" "main", C);',
    'INCLUDE_ASM("asm/nonmatchings/main", D)',
  ].join('\n');
  const scan = scanC(text);
  assert.deepEqual(scan.statements.map((s) => [s.dir, s.name, s.line, text.slice(s.start, s.end)]), [
    ['asm/nonmatchings/main', 'A', 3, 'INCLUDE_ASM("asm/nonmatchings/main", A);'],
    ['asm/nonmatchings/main', 'B', 4, 'INCLUDE_ASM ( /* dir */ "asm/nonmatchings/main" , B ) ;'],
  ]);
  assert.deepEqual(scan.definitions.map((d) => [d.name, d.line, text.slice(d.end - 1, d.end)]), [['Sum', 7, '}']]);
  assert.deepEqual(scan.others.map((o) => [o.first, o.line]), [['static', 5], ['struct', 6], ['void', 8], ['const', 9], ['INCLUDE_ASM', 10], ['INCLUDE_ASM', 11]]);
  assert.deepEqual(scan.directives.map((d) => d.kind), ['preprocessor', 'comment', 'comment']);
  assert.deepEqual(scan.unterminated, []);
});

test('scanC: a definition with an initializer-like body is not one; an unclosed definition runs to the end and is unscannable', () => {
  const scan = scanC('int (*fp)(void) = { 0 };\nint main(void) {\n  return 0;\n');
  assert.deepEqual(scan.others.map((o) => o.first), ['int']);
  assert.deepEqual(scan.definitions.map((d) => [d.name, d.end]), [['main', 'int (*fp)(void) = { 0 };\nint main(void) {\n  return 0;\n'.length]]);
  assert.deepEqual(scan.unscannable.map((u) => u.line), [2]);
  assert.deepEqual(scanC('/* open').unterminated.map((t) => t.kind), ['comment']);
  assert.deepEqual(scanC('/* open').unscannable, []);
});

test('the empty file and the template header: one stub per wanted function, in ROM order, each on its own line', () => {
  assert.equal(planned(''), `${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned(C_STUB_HEADER), `#include "include_asm.h"\n\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned('int x;'), `int x;\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`, 'a last line without its newline');
  assert.deepEqual(planIncludeAsm('', { module: 'main', chunks: same([]) }).edits, []);
  assert.ok(planIncludeAsm('', WANTED).edits.every((e) => e.reason === 'add-stub' && e.start === e.end));
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
  const text = `${stub('Old')} // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A']) }), ` // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n${stub('A')}\n`);
});

test('an insertion at the start of a removed line goes before the removal; the CRLF line ending goes with it', () => {
  const text = `${stub('A')}\r\n${stub('Old')}\r\n${stub('C')}\r\n`;
  assert.equal(planned(text, { module: 'main', chunks: same(['A', 'B', 'C']) }), `${stub('A')}\r\n${stub('B')}\n${stub('C')}\r\n`);
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
  assert.deepEqual(planIncludeAsm(done, wanted), { edits: [], diagnostics: [], unplaced: [], undeclared: [] });
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
  assert.deepEqual(planIncludeAsm(decompiled, { module: 'main', chunks, path: 'src/main.c' }), { edits: [], diagnostics: [], unplaced: [], undeclared: [] });
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
  assert.deepEqual(planIncludeAsm(text, WANTED), { edits: [], diagnostics: [], unplaced: [], undeclared: [] });
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
  const decompiled = `${stub('A', 'agbmain')}\nvoid B(void) {\n}\n${stub('C', 'agbmain')}\n`;
  const three: IncludeAsmWanted = { ...wanted, chunks: same(['A', 'B', 'C']), tree: { ...tree, files: new Set([...tree.files, 'asm/nonmatchings/boot/C.s']) } };
  assert.equal(planned(decompiled, three), `${stub('A', 'boot')}\nvoid B(void) {\n}\n${stub('C', 'boot')}\n`);
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

test('scanC names a function returning a function pointer and one with an attribute; a K&R definition is unscannable', () => {
  const names = (text: string): string[] => scanC(text).definitions.map((d) => d.name);
  assert.deepEqual(names('static void (*GetGfxFunc(void))(void) {\n    return 0;\n}\n'), ['GetGfxFunc']);
  assert.deepEqual(names('__attribute__((section(".iwram"))) void B(void) {}\n'), ['B']);
  assert.deepEqual(names('void C(int a) __attribute__((noinline));\nint D(void (*cb)(void)) { return 0; }\n'), ['D']);
  const fnPointer = `${stub('A')}\nvoid (*B(void))(void) {\n    return 0;\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(fnPointer, WANTED).edits, [], 'B is held: no stub inserted beside it');
  const knr = `${stub('A')}\nint B(a) int a; {\n    return a;\n}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(knr, WANTED).diagnostics.map((d) => d.code), ['E_C_UNSCANNABLE']);
  assert.deepEqual(planIncludeAsm(knr, WANTED).edits, []);
});

test('compiledDefinitions: named definitions outside every conditional, the one rule for what the C defines', () => {
  const scan = scanC('#ifdef NONMATCHING\nvoid Foo(void) {\n}\n#endif\nvoid Bar(void) {\n}\n');
  assert.deepEqual(scan.definitions.map((d) => d.name), ['Foo', 'Bar']);
  assert.deepEqual(compiledDefinitions(scan), { scannable: true, definitions: [scan.definitions[1]] });
  // A bare macro a conditional leaves unfinished (sa2's `#if COLLECT_RINGS_ROM END_NONMATCH #endif`) is no part of the
  // next head: that definition starts at its own head, outside the region, and is compiled (fix round 5).
  const leftover = scanC('#if COLLECT_RINGS_ROM\nEND_NONMATCH\n#endif\n\nstatic void Task(void)\n{\n}\n');
  assert.deepEqual(leftover.definitions.map((d) => [d.name, d.line]), [['Task', 5]]);
  assert.deepEqual(compiledDefinitions(leftover).definitions.map((d) => d.name), ['Task']);
  // An unscannable file: the definitions as far as the scanner read, and why (architecture-b0-2).
  const knr = scanC('int K(a) int a; {\n    return a;\n}\nvoid L(void) {\n}\n');
  const compiled = compiledDefinitions(knr);
  assert.equal(compiled.scannable, false);
  assert.ok(!compiled.scannable && compiled.unscannable.length === 1);
});
