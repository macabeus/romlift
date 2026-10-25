// The parser of romlift's directive subset (architecture §6.4, D49): every directive form, the macros of
// DIALECT.macrosInc, comments, labels and errors as values.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import { parseExpr, parseNumber, parseStatements } from '../../../src/foundation/asm/statements.ts';
import type { ParsedStatements, Statement } from '../../../src/foundation/asm/statements.ts';

const MACROS = new Map([['include/macros.inc', DIALECT.macrosInc]]);

function parsed(text: string, includes: ReadonlyMap<string, string> = MACROS): ParsedStatements {
  return parseStatements(text, { includes });
}

function ok(text: string, includes?: ReadonlyMap<string, string>): readonly Statement[] {
  const result = parsed(text, includes);
  assert.deepEqual(result.errors, []);
  return result.statements;
}

/** The single error message of a text that must fail, with its line. */
function failure(text: string): { readonly line: number; readonly message: string } {
  const result = parsed(text);
  assert.equal(result.errors.length, 1, JSON.stringify(result.errors));
  const [error] = result.errors;
  assert.ok(error !== undefined);
  return error;
}

test('the dialect preamble reads as syntax, the macro include and a mode', () => {
  assert.deepEqual(ok(DIALECT.preamble('thumb')), [
    { kind: 'symbol', line: 1, directive: '.syntax', args: ['unified'] },
    { kind: 'mode', line: 3, mode: 'thumb' },
  ]);
  assert.deepEqual(ok(DIALECT.preamble('arm')).at(-1), { kind: 'mode', line: 3, mode: 'arm' });
});

test('symbol directives keep their arguments and emit no bytes', () => {
  assert.deepEqual(ok('.text\n.global Foo\n.globl Bar, Baz\n.type Foo, %function\n.size Foo, . - Foo\n.thumb_func\n.type D, %object\n.size D, 12'), [
    { kind: 'symbol', line: 1, directive: '.text', args: [] },
    { kind: 'symbol', line: 2, directive: '.global', args: ['Foo'] },
    { kind: 'symbol', line: 3, directive: '.globl', args: ['Bar', 'Baz'] },
    { kind: 'symbol', line: 4, directive: '.type', args: ['Foo', '%function'] },
    { kind: 'symbol', line: 5, directive: '.size', args: ['Foo', '.-Foo'] },
    { kind: 'symbol', line: 6, directive: '.thumb_func', args: [] },
    { kind: 'symbol', line: 7, directive: '.type', args: ['D', '%object'] },
    { kind: 'symbol', line: 8, directive: '.size', args: ['D', '12'] },
  ]);
});

test('mode directives: .thumb, .arm, .code 16 and .code 32', () => {
  assert.deepEqual(
    ok('.thumb\n.arm\n.code 16\n.code 32').map((s) => (s.kind === 'mode' ? s.mode : s.kind)),
    ['thumb', 'arm', 'thumb', 'arm'],
  );
});

test('.align with and without a fill byte', () => {
  assert.deepEqual(ok('.align 2, 0\n.align 2\n.align 3, 0xff'), [
    { kind: 'align', line: 1, power: 2, fill: 0 },
    { kind: 'align', line: 2, power: 2 },
    { kind: 'align', line: 3, power: 3, fill: 255 },
  ]);
});

test('data directives read comma lists of numbers and symbols with addends', () => {
  assert.deepEqual(ok('.byte 0x1A, 255, -1\n.2byte 0xF800\n.hword 7\n.4byte Func, _08001234 + 1, gFoo - 0x10, 0\n.word 0xFFFFFFFF'), [
    { kind: 'data', line: 1, width: 1, values: [{ kind: 'number', value: 0x1a }, { kind: 'number', value: 255 }, { kind: 'number', value: -1 }] },
    { kind: 'data', line: 2, width: 2, values: [{ kind: 'number', value: 0xf800 }] },
    { kind: 'data', line: 3, width: 2, values: [{ kind: 'number', value: 7 }] },
    {
      kind: 'data',
      line: 4,
      width: 4,
      values: [
        { kind: 'symbol', name: 'Func', addend: 0 },
        { kind: 'symbol', name: '_08001234', addend: 1 },
        { kind: 'symbol', name: 'gFoo', addend: -16 },
        { kind: 'number', value: 0 },
      ],
    },
    { kind: 'data', line: 5, width: 4, values: [{ kind: 'number', value: 0xffff_ffff }] },
  ]);
});

test('numbers are decimal or 0x hex; a leading zero (octal to GNU as) and the location counter are refused', () => {
  assert.equal(parseNumber('0x1aF'), 0x1af);
  assert.equal(parseNumber('42'), 42);
  assert.equal(parseNumber('0'), 0);
  assert.equal(parseNumber('-0x10'), -16);
  assert.equal(parseNumber('010'), undefined);
  assert.equal(parseNumber('0X10'), undefined);
  assert.equal(parseNumber('1e3'), undefined);
  assert.deepEqual(parseExpr('a+2'), { kind: 'symbol', name: 'a', addend: 2 });
  assert.equal(typeof parseExpr('.'), 'string');
  assert.equal(typeof parseExpr('a + b'), 'string');
  assert.equal(typeof parseExpr('2 + a'), 'string');
});

test('.inst.n, .inst.w and .inst with trailing comments; .inst.w is stored first halfword | second << 16', () => {
  assert.deepEqual(ok('\t.inst.n 0x46C0 @ mov r8, r8 (as-alias)\n\t.inst.w 0xF000F800 @ bl 0x08000004\n\t.inst 0xE1A00000 @ nop'), [
    { kind: 'inst', line: 1, directive: '.inst.n', width: 2, word: 0x46c0 },
    { kind: 'inst', line: 2, directive: '.inst.w', width: 4, word: 0xf800_f000 },
    { kind: 'inst', line: 3, directive: '.inst', width: 4, word: 0xe1a0_0000 },
  ]);
  assert.match(failure('.inst.n 0x12345').message, /fits/);
});

test('.incbin reads a file, an offset and a length', () => {
  assert.deepEqual(ok('\t.incbin "baserom.gba", 0x1A3C, 0x100'), [{ kind: 'incbin', line: 1, file: 'baserom.gba', offset: 0x1a3c, length: 0x100 }]);
  assert.match(failure('.incbin "baserom.gba", 4').message, /offset, length/);
  assert.match(failure('.incbin baserom.gba, 0, 4').message, /offset, length/);
});

test('an include that is not a macro file becomes an include statement', () => {
  assert.deepEqual(ok('.include "asm/nonmatchings/main/Foo.s"'), [{ kind: 'include', line: 1, path: 'asm/nonmatchings/main/Foo.s' }]);
  // Known to the caller but holding no macros: still the caller's to resolve.
  assert.deepEqual(ok('.include "x.s"', new Map([['x.s', '\tbx lr\n']])), [{ kind: 'include', line: 1, path: 'x.s' }]);
  // Without the macro file the macros are unknown, so the include stays a statement.
  assert.deepEqual(ok('.include "include/macros.inc"', new Map()), [{ kind: 'include', line: 1, path: 'include/macros.inc' }]);
});

test('labels: one, several on a line, and a label followed by a statement', () => {
  assert.deepEqual(ok('Foo:\n_08000010: @ 08000010\na: b: .2byte 1\n.L1: bx lr'), [
    { kind: 'label', line: 1, name: 'Foo' },
    { kind: 'label', line: 2, name: '_08000010' },
    { kind: 'label', line: 3, name: 'a' },
    { kind: 'label', line: 3, name: 'b' },
    { kind: 'data', line: 3, width: 2, values: [{ kind: 'number', value: 1 }] },
    { kind: 'label', line: 4, name: '.L1' },
    { kind: 'insn', line: 4, text: 'bx lr' },
  ]);
});

test('comments run to the end of the line, blank lines vanish, `;` separates statements, CRLF is read', () => {
  assert.deepEqual(ok('@ a whole-line comment\n\n\tldr r0, _08001A3C @ =gFoo\r\n\tmovs r0, #1; bx lr\n.incbin "a@b", 0, 1 @ c'), [
    { kind: 'insn', line: 3, text: 'ldr r0, _08001A3C' },
    { kind: 'insn', line: 4, text: 'movs r0, #1' },
    { kind: 'insn', line: 4, text: 'bx lr' },
    { kind: 'incbin', line: 5, file: 'a@b', offset: 0, length: 1 },
  ]);
});

/** The statements one macro invocation expands to, at line 3 (after the preamble's include). */
function expansion(invocation: string): readonly Statement[] {
  return ok(`.syntax unified\n.include "include/macros.inc"\n${invocation}`).slice(1);
}

test('the eight macros of DIALECT.macrosInc expand with the invoking line', () => {
  const align = { kind: 'align', line: 3, power: 2, fill: 0 } as const;
  const global = { kind: 'symbol', line: 3, directive: '.global', args: ['Foo'] } as const;
  const thumb = { kind: 'mode', line: 3, mode: 'thumb' } as const;
  const arm = { kind: 'mode', line: 3, mode: 'arm' } as const;
  const thumbFunc = { kind: 'symbol', line: 3, directive: '.thumb_func', args: [] } as const;
  const type = { kind: 'symbol', line: 3, directive: '.type', args: ['Foo', '%function'] } as const;
  const size = { kind: 'symbol', line: 3, directive: '.size', args: ['Foo', '.-Foo'] } as const;
  assert.deepEqual(expansion('\tthumb_func_start Foo'), [align, global, thumb, thumbFunc, type]);
  assert.deepEqual(expansion('\tthumb_func_start_local Foo'), [align, thumb, thumbFunc, type]);
  assert.deepEqual(expansion('\tnon_word_aligned_thumb_func_start Foo'), [global, thumb, thumbFunc, type]);
  assert.deepEqual(expansion('\tnon_word_aligned_thumb_func_start_local Foo'), [thumb, thumbFunc, type]);
  assert.deepEqual(expansion('\tarm_func_start Foo'), [align, global, arm, type]);
  assert.deepEqual(expansion('\tarm_func_start_local Foo'), [align, arm, type]);
  assert.deepEqual(expansion('\tthumb_func_end Foo'), [size]);
  assert.deepEqual(expansion('\tarm_func_end Foo'), [size]);
});

test('a macro defined in the text expands with comma or space separated arguments and \\()', () => {
  const text = '.macro pair a, b\n\t.2byte \\a, \\b\n\t\\a\\()_end: .byte 0\n.endm\n\tpair n, 2\n\tpair x y';
  assert.deepEqual(ok(text), [
    { kind: 'data', line: 5, width: 2, values: [{ kind: 'symbol', name: 'n', addend: 0 }, { kind: 'number', value: 2 }] },
    { kind: 'label', line: 5, name: 'n_end' },
    { kind: 'data', line: 5, width: 1, values: [{ kind: 'number', value: 0 }] },
    { kind: 'data', line: 6, width: 2, values: [{ kind: 'symbol', name: 'x', addend: 0 }, { kind: 'symbol', name: 'y', addend: 0 }] },
    { kind: 'label', line: 6, name: 'x_end' },
    { kind: 'data', line: 6, width: 1, values: [{ kind: 'number', value: 0 }] },
  ]);
});

test('any other line is an instruction text for the layouter', () => {
  assert.deepEqual(ok('\tpush {r4, lr}\n\tbl Foo\n\tnotamnemonic r0'), [
    { kind: 'insn', line: 1, text: 'push {r4, lr}' },
    { kind: 'insn', line: 2, text: 'bl Foo' },
    { kind: 'insn', line: 3, text: 'notamnemonic r0' },
  ]);
});

test('errors are values with their line, and the other statements are kept', () => {
  const result = parsed('.byte 1\n.balign 4\n.byte 2');
  assert.deepEqual(result.errors, [{ line: 2, message: 'unsupported directive `.balign`' }]);
  assert.equal(result.statements.length, 2);

  for (const [text, pattern] of [
    ['.syntax mixed', /unified/],
    ['.syntax divided\n\tmovs r0, #0', /under `\.syntax divided`/],
    ['.syntax divided\n.include "asm/x.s"', /under `\.syntax divided`/],
    ['.code 64', /16 and 32/],
    ['.align', /power/],
    ['.align 16', /power/],
    ['.align 2, 256', /byte/],
    ['.byte', /at least one/],
    ['.4byte a +', /unreadable expression/],
    ['.byte 010', /unreadable expression/],
    ['.global 1x', /symbol names/],
    ['.type Foo, function', /%function/],
    ['.size Foo, .-Bar', /\.-name/],
    ['.thumb 1', /no argument/],
    ['.include foo.s', /"path"/],
    ['.endm', /without/],
    ['.macro 1bad', /macro name/],
    ['.macro m x=1', /parameter/],
  ] as const) {
    assert.match(failure(text).message, pattern, text);
  }
});

// Fix round 2 (architecture-r1-3): agbcc's stub assembly closes each INCLUDE_ASM with `.syntax divided`.
test('`.syntax divided` is read as no bytes; `.syntax unified` lifts it before the next include or instruction', () => {
  const result = parsed('\t.syntax unified\n.include "asm/a.s"\n.syntax divided\n\n\t.syntax unified\n.include "asm/b.s"\n.syntax divided\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.statements.map((st) => (st.kind === 'symbol' ? `${st.directive} ${st.args.join(',')}` : st.kind === 'include' ? st.path : st.kind)),
    ['.syntax unified', 'asm/a.s', '.syntax divided', '.syntax unified', 'asm/b.s', '.syntax divided'],
  );
});

test('macro errors: wrong argument count, recursion, a missing .endm', () => {
  assert.match(failure('.include "include/macros.inc"\n\tthumb_func_start\n').message, /takes 1 argument/);
  const recursive = failure('.macro loop\n\tloop\n.endm\n\tloop');
  assert.equal(recursive.line, 4);
  assert.match(recursive.message, /nests deeper/);
  assert.deepEqual(failure('.macro open\n\tbx lr'), { line: 1, message: 'macro `open` has no `.endm`' });
});

test('a macro defined twice is an error, as in GNU as (macros.inc included twice)', () => {
  const twice = parsed('.include "include/macros.inc"\n.include "include/macros.inc"');
  assert.equal(twice.errors.length, 8);
  assert.deepEqual(twice.errors[0], { line: 2, message: 'in "include/macros.inc" line 1: macro `arm_func_start` is already defined' });
  assert.deepEqual(failure('.macro m\n.endm\n.macro m\n.endm'), { line: 3, message: 'macro `m` is already defined' });
});

test('a macro file holding anything but macros is an error at the include line', () => {
  const includes = new Map([['m.inc', '.macro m\n.endm\n\t.byte 1\n']]);
  const result = parseStatements('\n.include "m.inc"', { includes });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.line, 2);
  assert.match(result.errors[0]?.message ?? '', /only macros/);

  const broken = parseStatements('.include "m.inc"', { includes: new Map([['m.inc', '.macro m\n\t.byte 1\n']]) });
  assert.match(broken.errors[0]?.message ?? '', /in "m.inc" line 1: macro `m` has no `.endm`/);

  const cyclic = parseStatements('.include "m.inc"', { includes: new Map([['m.inc', '.macro m\n.endm\n.include "m.inc"\n']]) });
  assert.ok(cyclic.errors.some((e) => e.line === 1 && /included deeper than 32/.test(e.message)), JSON.stringify(cyclic.errors));
});
