// scanC, compiledDefinitions and the include resolution (core/reconcile/c-scan.ts; architecture §6.3 `c-stub`, §6.6,
// roadmap 4.C): file-scope INCLUDE_ASM statements, function definitions and other code found through the tokenizer, a
// preprocessor conditional read as the preprocessor reads it, the one rule for what the C defines, and the include
// helpers the planner follows a file's fragments and headers with. The planner's own tests are include-asm.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compiledDefinitions, fragmentPhrase, headerCandidates, headerPath, includesOf, includeSpelling, laterThan, macroProvided, resolveInclude, scanC, withFragments } from '../../../src/core/reconcile/c-scan.ts';

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

test('scanC names a function returning a function pointer and one with an attribute', () => {
  const names = (text: string): string[] => scanC(text).definitions.map((d) => d.name);
  assert.deepEqual(names('static void (*GetGfxFunc(void))(void) {\n    return 0;\n}\n'), ['GetGfxFunc']);
  assert.deepEqual(names('__attribute__((section(".iwram"))) void B(void) {}\n'), ['B']);
  assert.deepEqual(names('void C(int a) __attribute__((noinline));\nint D(void (*cb)(void)) { return 0; }\n'), ['D']);
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

test('resolveInclude and headerPath: a quoted include from the including file\'s directory first, then include/; an angle one from include/ alone', () => {
  assert.equal(resolveInclude('src/main.c', 'part.c'), 'src/part.c');
  assert.equal(resolveInclude('src/sub/a.c', '../b.h'), 'src/b.h');
  assert.equal(resolveInclude('src/main.c', '../../up.h'), undefined, 'above the root');
  const headers = new Map([['src/local.h', ''], ['include/global.h', ''], ['include/local.h', '']]);
  assert.equal(headerPath('src/main.c', 'local.h', false, headers), 'src/local.h');
  assert.equal(headerPath('src/main.c', 'local.h', true, headers), 'include/local.h');
  assert.equal(headerPath('src/main.c', 'global.h', false, headers), 'include/global.h');
  assert.equal(headerPath('src/main.c', 'missing.h', false, headers), undefined);
  assert.deepEqual(includeSpelling('#include <gba/gba.h>'), { spelled: 'gba/gba.h', angle: true });
  assert.deepEqual(includeSpelling('#  include "global.h"'), { spelled: 'global.h', angle: false });
  assert.equal(includeSpelling('#define X 1'), undefined);
});

// Phase 6 (roadmap "Carried from phase 4": D89 a, D90 a): cpp-exact behind symbolic links. A quoted include is
// resolved from the including file's real directory (headerRealPaths), as cc -E and arm-none-eabi-cpp open it.
test('headerCandidates: from the including file\'s real directory, then include/; a .. after a named directory stays written', () => {
  assert.deepEqual(headerCandidates('src/main.c', 'global.h', false), ['src/global.h', 'include/global.h']);
  assert.deepEqual(headerCandidates('src/main.c', 'global.h', true), ['include/global.h']);
  assert.deepEqual(headerCandidates('include/global.h', 'gba/gba.h', false), ['include/gba/gba.h'], 'one candidate when both are one');
  assert.deepEqual(headerCandidates('src/main.c', '../include/x.h', false), ['include/x.h', 'include/../include/x.h']);
  // A header behind include/gba -> /s/gba: "../glue.h" from the link's target, the system's own resolution.
  const real = new Map([['include/gba/macro.h', '/s/gba/macro.h'], ['include/global.h', 'global.h']]);
  assert.deepEqual(headerCandidates('include/gba/macro.h', '../glue.h', false, real), ['/s/glue.h', 'include/../glue.h']);
  assert.deepEqual(headerCandidates('include/gba/macro.h', '../../../../x.h', false, real)[0], '/x.h', 'the root is its own parent');
  // include -> .: global.h's real directory is the project's top; above it, a leading `..`.
  assert.deepEqual(headerCandidates('include/global.h', 'macros.h', false, real), ['macros.h', 'include/macros.h']);
  assert.deepEqual(headerCandidates('include/global.h', '../up.h', false, real), ['../up.h', 'include/../up.h']);
  // A named directory may be a link: the `..` after it stays for the system to resolve.
  assert.deepEqual(headerCandidates('src/main.c', 'gba/../glue.h', true), ['include/gba/../glue.h']);
  assert.deepEqual(headerCandidates('src/main.c', './a//b.h', false), ['src/a/b.h', 'include/a/b.h']);
  assert.deepEqual(headerCandidates('src/main.c', '/abs/x.h', false), ['/abs/x.h']);
});

test('headerPath and macroProvided read a header behind a linked directory from its real directory', () => {
  const real = new Map([['include/gba/macro.h', '/s/gba/macro.h']]);
  const headers = new Map([['include/gba/macro.h', '#include "../glue.h"\n'], ['include/glue.h', 'typedef int t;\n'], ['/s/glue.h', '#define INCLUDE_ASM(DIR, NAME)\n']]);
  assert.equal(headerPath('include/gba/macro.h', '../glue.h', false, headers, real), '/s/glue.h');
  assert.equal(headerPath('include/gba/macro.h', '../glue.h', false, headers), 'include/glue.h', 'without real paths, where the key says');
  const scan = scanC('#include "gba/macro.h"\n');
  assert.ok(macroProvided(scan, { path: 'src/main.c', headers, headerRealPaths: real }, []), 'the target\'s glue.h defines it');
  assert.ok(!macroProvided(scan, { path: 'src/main.c', headers }, []), 'the link\'s path names include/glue.h, which does not');
});

test('includesOf: every #include line in text order, in a conditional too, never one in a comment or a literal', () => {
  const text = '#include "a.h"\n/* #include "no.h" */\nconst char *s = "#include <no.h>";\n#if 0\n#include <b.h>\n#endif\n#define X 1\n';
  assert.deepEqual(includesOf(text), [{ spelled: 'a.h', angle: false }, { spelled: 'b.h', angle: true }]);
});

test('laterThan and fragmentPhrase: the text order through the includes, and a fragment named through its chain', () => {
  assert.ok(laterThan({ start: 10 }, { start: 5 }));
  assert.ok(!laterThan({ start: 5, order: [5, 0] }, { start: 5, order: [5, 7] }));
  assert.ok(laterThan({ start: 5, order: [5, 7, 1] }, { start: 5, order: [5, 7] }), 'a longer key after its own prefix');
  assert.equal(fragmentPhrase('src/b.c', 'src/main.c', 3), 'src/b.c, which src/main.c includes (line 3)');
  assert.equal(fragmentPhrase('src/b.c', 'src/main.c', 68, [{ from: 'src/main.c', line: 68 }, { from: 'src/a.c', line: 3 }]), 'src/b.c, which src/a.c includes (line 3), which src/main.c includes (line 68)');
});

test('withFragments: a fragment\'s definitions and statements at the #include line; unread includes and module sources kept apart', () => {
  const text = '#include "global.h"\n#include "part.c"\n#include "other.c"\n#include "mod.c"\n';
  const scan = scanC(text);
  const fragments = new Map([['src/part.c', 'void P(void) {\n}\nINCLUDE_ASM("asm/nonmatchings/main", Q);\n']]);
  const out = withFragments(scan, { path: 'src/main.c', fragments, sources: new Map([['src/mod.c', 'mod']]) });
  assert.deepEqual(out.included, ['src/part.c']);
  assert.deepEqual(out.scan.definitions.map((d) => [d.name, d.line, d.via]), [['P', 2, 'src/part.c']]);
  assert.deepEqual(out.scan.statements.map((s) => [s.name, s.line, s.fragmentLine, s.via]), [['Q', 2, 3, 'src/part.c']]);
  assert.deepEqual(out.unread.map((u) => [u.spelled, u.line, u.module]), [['other.c', 3, undefined], ['mod.c', 4, 'mod']]);
  assert.deepEqual(out.unscannable, []);
  assert.deepEqual(withFragments(scan, { fragments }), { scan, included: [], unread: [], unscannable: [] }, 'no path: includes are not followed');
});
