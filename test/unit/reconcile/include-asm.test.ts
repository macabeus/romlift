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

import { planIncludeAsm, scanC } from '../../../src/core/reconcile/include-asm.ts';
import type { IncludeAsmWanted } from '../../../src/core/reconcile/include-asm.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';
import { C_STUB_HEADER, includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';

const WANTED: IncludeAsmWanted = { module: 'main', names: ['A', 'B', 'C', 'D'], path: 'src/main.c' };

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

test('scanC: a definition with an initializer-like body is not one; an unclosed definition runs to the end', () => {
  const scan = scanC('int (*fp)(void) = { 0 };\nint main(void) {\n  return 0;\n');
  assert.deepEqual(scan.others.map((o) => o.first), ['int']);
  assert.deepEqual(scan.definitions.map((d) => [d.name, d.end]), [['main', 'int (*fp)(void) = { 0 };\nint main(void) {\n  return 0;\n'.length]]);
  assert.deepEqual(scanC('/* open').unterminated.map((t) => t.kind), ['comment']);
});

test('the empty file and the template header: one stub per wanted function, in ROM order, each on its own line', () => {
  assert.equal(planned(''), `${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned(C_STUB_HEADER), `#include "include_asm.h"\n\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned('int x;'), `int x;\n${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`, 'a last line without its newline');
  assert.deepEqual(planIncludeAsm('', { module: 'main', names: [] }).edits, []);
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
  assert.equal(planned(text, { module: 'main', names: ['A'] }), `${stub('A', 'other')}\n${stub('A')}\n`);
});

test('W_C_ORDER when the held functions are out of ROM order; the planner still only inserts', () => {
  const text = `${stub('C')}\n${stub('A')}\n`;
  const plan = planIncludeAsm(text, WANTED);
  assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path, d.message]), [['W_C_ORDER', 'warning', 'src/main.c', 'src/main.c holds C before A, which comes first in ROM order']]);
  assert.equal(applyTextEdits(text, plan.edits), `${stub('C')}\n${stub('D')}\n${stub('A')}\n${stub('B')}\n`);
  assert.deepEqual(planIncludeAsm(`${stub('A')}\n${stub('C')}\n`, WANTED).diagnostics, [], 'in order');
  const unnamed = planIncludeAsm(text, { module: 'main', names: ['A', 'C'] }).diagnostics[0];
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
  assert.equal(planned(`${stub('A')} int x;`, { module: 'main', names: ['A', 'B'] }), `${stub('A')} \n${stub('B')}\nint x;`);
});

test('a stub whose function is no longer wanted is removed with its line; a rename is a removal and an insertion', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n${stub('Old')}\n${stub('C')}\n${stub('Gone')}\n`;
  const plan = planIncludeAsm(text, { module: 'main', names: ['A', 'New', 'C'] });
  assert.deepEqual(plan.edits.map((e) => e.reason), ['add-stub', 'remove-stub', 'remove-stub']);
  assert.equal(applyTextEdits(text, plan.edits), `${C_STUB_HEADER}${stub('A')}\n${stub('New')}\n${stub('C')}\n`);
});

test('a module split or moved: the stubs of the functions that left are removed, those of another directory kept', () => {
  const text = `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('X', 'other')}\n${stub('C')}\n${stub('D')}`;
  assert.equal(planned(text, { module: 'main', names: ['A', 'B'] }), `${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('X', 'other')}\n`);
  assert.equal(planned(`${C_STUB_HEADER}${stub('A')}\n`, { module: 'main', names: [] }), C_STUB_HEADER, 'every function gone');
});

test('a removed stub that shares its line keeps the rest of the line; comments and definitions are never removed', () => {
  const text = `${stub('Old')} // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n`;
  assert.equal(planned(text, { module: 'main', names: ['A'] }), ` // was Old\nvoid Old(void) { }\n/* ${stub('Old')} */\n${stub('A')}\n`);
});

test('an insertion at the start of a removed line goes before the removal; the CRLF line ending goes with it', () => {
  const text = `${stub('A')}\r\n${stub('Old')}\r\n${stub('C')}\r\n`;
  assert.equal(planned(text, { module: 'main', names: ['A', 'B', 'C'] }), `${stub('A')}\r\n${stub('B')}\n${stub('C')}\r\n`);
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
  assert.equal(planned(later, { module: 'main', names: ['Z', 'A'] }), `${C_STUB_HEADER}${stub('Z')}\n/* A, matched one day */\n${NONMATCHING('A')}`);
  // Nested conditionals count as one outer region.
  const nested = `#if 1\n#ifdef X\n${stub('A')}\n#endif\n#endif\n`;
  assert.equal(planned(nested, { module: 'main', names: ['A', 'B'] }), `${nested}${stub('B')}\n`);
});

test('an unclosed #if leaves no safe place inside or after it: E_C_STUB_UNPLACED; before it is safe', () => {
  const before = `${stub('A')}\n#ifdef NONMATCHING\n`;
  assert.equal(planned(before, { module: 'main', names: ['A', 'B'] }), `${stub('A')}\n${stub('B')}\n#ifdef NONMATCHING\n`, 'after a held item at depth 0');
  const inside = `#ifdef NONMATCHING\n${stub('A')}\n`;
  const plan = planIncludeAsm(inside, { module: 'main', names: ['A', 'B'], path: 'src/main.c' });
  assert.deepEqual(plan.unplaced, ['B']);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.diagnostics.map((d) => d.code), ['E_C_STUB_UNPLACED']);
  assert.deepEqual(planIncludeAsm('#if 0\n', { module: 'main', names: ['A'] }).unplaced, ['A'], 'nothing held: not at the end either');
  assert.deepEqual(planIncludeAsm(inside, { module: 'main', names: ['Z', 'A'] }).edits.map((e) => e.start), [0], 'before the #if is safe');
});

test('a leading byte order mark is no code: the file is read as without it, and stays first', () => {
  const BOM = '\uFEFF';
  const text = `${BOM}${C_STUB_HEADER}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`;
  assert.deepEqual(planIncludeAsm(text, WANTED).edits, [], 'nothing to add: the first stub is recognised');
  assert.equal(scanC(text).directives[0]?.kind, 'preprocessor', 'the #include after the mark is a directive');
  assert.equal(planned(`${BOM}${stub('B')}\n`, WANTED), `${BOM}${stub('A')}\n${stub('B')}\n${stub('C')}\n${stub('D')}\n`);
  assert.equal(planned(`${BOM}${stub('Old')}\n`, { module: 'main', names: [] }), BOM, 'a removal keeps the mark');
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
  assert.equal(planned(text, { module: 'main', names: ['A', 'C'] }), `${stub('A')}\n${stub('C')}\n`);
});
