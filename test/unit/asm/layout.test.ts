// The byte layouter of the text-layout self-check (architecture §6.4, D49): writer-shaped texts laid out
// from their absolute start, against encodings written out by hand from the ARM ARM (not through the
// encoder under test), and errors as values.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import { layoutMemo, layoutStatements } from '../../../src/foundation/asm/layout.ts';
import type { Layout, LayoutInput, LayoutMemo } from '../../../src/foundation/asm/layout.ts';
import { parseStatements } from '../../../src/foundation/asm/statements.ts';
import type { Statement } from '../../../src/foundation/asm/statements.ts';
import type { Mode } from '../../../src/foundation/rom/span.ts';

const MACROS = new Map([['include/macros.inc', DIALECT.macrosInc]]);
const BASE = 0x0800_0000;

function statementsOf(text: string): readonly Statement[] {
  const parsed = parseStatements(text, { includes: MACROS });
  assert.deepEqual(parsed.errors, []);
  return parsed.statements;
}

interface Options {
  readonly start?: number;
  readonly mode?: Mode;
  readonly symbols?: Readonly<Record<string, number>>;
  readonly files?: Readonly<Record<string, Uint8Array>>;
  readonly includes?: Readonly<Record<string, string>>;
  readonly memo?: LayoutMemo;
  readonly sameObject?: (name: string) => boolean;
}

function lay(text: string, options: Options = {}): Layout {
  const symbols = options.symbols ?? {};
  const files = options.files ?? {};
  const includes = options.includes ?? {};
  const input: LayoutInput = {
    statements: statementsOf(text),
    start: options.start ?? BASE,
    mode: options.mode ?? 'thumb',
    resolve: (name) => symbols[name],
    incbin: (file, offset, length) => files[file]?.slice(offset, offset + length),
    include: (path) => {
      const inner = includes[path];
      return inner === undefined ? undefined : statementsOf(inner);
    },
    ...(options.memo === undefined ? {} : { memo: options.memo }),
    ...(options.sameObject === undefined ? {} : { sameObject: options.sameObject }),
  };
  return layoutStatements(input);
}

/** Lays a text out that must have no errors. */
function clean(text: string, options: Options = {}): Layout {
  const out = lay(text, options);
  assert.deepEqual(out.errors, []);
  assert.equal(out.end, (options.start ?? BASE) + out.bytes.length);
  return out;
}

/** Little-endian bytes of halfwords and words: [2, 0xB500] is one halfword, [4, 0xE12FFF1E] one word. */
function le(...units: readonly (readonly [2 | 4, number])[]): Uint8Array {
  const out: number[] = [];
  for (const [size, value] of units) for (let i = 0; i < size; i++) out.push(Math.floor(value / 2 ** (8 * i)) & 0xff);
  return Uint8Array.from(out);
}

const h = (v: number): readonly [2, number] => [2, v];
const w = (v: number): readonly [4, number] => [4, v];

/** A Thumb bl pair from `from` to `to`, as its two halfwords. */
function thumbBl(from: number, to: number): readonly (readonly [2, number])[] {
  const off = to - (from + 4);
  return [h(0xf000 | ((off >> 12) & 0x7ff)), h(0xf800 | ((off >> 1) & 0x7ff))];
}

const PREAMBLE = DIALECT.preamble('thumb');

test('a Thumb function with a pool load and its pool word after `.align 2, 0`', () => {
  const text = `${PREAMBLE}\tthumb_func_start Foo
Foo: @ 08000000
\tpush {lr}
\tldr r0, _08000008 @ =gFoo
\tbx r0
\t.align 2, 0
_08000008: .4byte gFoo
\tthumb_func_end Foo
`;
  const out = clean(text, { symbols: { gFoo: 0x0300_1234 } });
  // ldr r0, [pc, #4]: pc = 0x08000006, Align(pc, 4) = 0x08000004, imm8 = 1.
  assert.deepEqual(out.bytes, le(h(0xb500), h(0x4801), h(0x4700), h(0), w(0x0300_1234)));
  assert.deepEqual(out.aligns, [
    { line: 4, at: BASE, length: 0 },
    { line: 9, at: BASE + 6, length: 2 },
  ]);
  assert.deepEqual([...out.labels], [
    ['Foo', BASE],
    ['_08000008', BASE + 8],
  ]);
});

test('a non-word-aligned Thumb start (2 mod 4) keeps its address; the aligned macro pads instead', () => {
  const body = `Bar:
\tldr r1, _08000008
\tbx lr
\t.align 2, 0
_08000008: .4byte Bar
`;
  const out = clean(`${PREAMBLE}\tnon_word_aligned_thumb_func_start Bar\n${body}`, { start: BASE + 2 });
  // At 0x08000002: pc = 0x08000006, Align(pc, 4) = 0x08000004, imm8 = 1. Bar is a Thumb function: + 1.
  assert.deepEqual(out.bytes, le(h(0x4901), h(0x4770), h(0), w(BASE + 3)));
  assert.equal(out.labels.get('Bar'), BASE + 2);
  assert.deepEqual(out.aligns, [{ line: 8, at: BASE + 6, length: 2 }]);

  const padded = lay(`${PREAMBLE}\tthumb_func_start Bar\n${body}`, { start: BASE + 2 });
  assert.equal(padded.labels.get('Bar'), BASE + 4);
  assert.deepEqual(padded.aligns[0], { line: 4, at: BASE + 2, length: 2 });
});

test('an ARM function after `bx pc`: the padding, the mode switch and an ARM pool load', () => {
  const tail = `\t.arm
_08000004:
\tldr r0, _08000010
\tbx r0
\tbx lr
_08000010: .4byte Target
`;
  const symbols = { Target: 0x0800_0101 };
  // ldr r0, [pc, #4] at 0x08000004: pc = 0x0800000C.
  const arm = [w(0xe59f_0004), w(0xe12f_ff10), w(0xe12f_ff1e), w(0x0800_0101)];
  const head = `${PREAMBLE}\tthumb_func_start Veneer\nVeneer:\n\tbx pc\n`;

  const aligned = clean(`${head}\t.align 2, 0\n${tail}`, { symbols });
  assert.deepEqual(aligned.bytes, le(h(0x4778), h(0), ...arm));
  assert.deepEqual(aligned.aligns.at(-1), { line: 7, at: BASE + 2, length: 2 });

  // A switch to ARM state pads to a word with zeros by itself, as GNU as does; the pad is reported.
  const implicit = clean(`${head}${tail}`, { symbols });
  assert.deepEqual(implicit.bytes, aligned.bytes);
  assert.deepEqual(implicit.aligns.at(-1), { line: 7, at: BASE + 2, length: 2 });

  const nop = clean(`${head}\tmov r8, r8\n${tail}`, { symbols });
  assert.deepEqual(nop.bytes, le(h(0x4778), h(0x46c0), ...arm));
  assert.equal(nop.aligns.length, 1);
});

test('an ARM function with a local bl; its label stands for an even value', () => {
  const text = `.syntax unified\n.include "include/macros.inc"\n.arm
\tarm_func_start ArmFoo
ArmFoo:
\tbl _local
\tbx lr
_local: bx lr
\tarm_func_end ArmFoo
\t.4byte ArmFoo, _local + 1
`;
  const out = clean(text, { mode: 'arm' });
  // bl at 0x08000000 to 0x08000008: offset (8 - 8) / 4 = 0.
  assert.deepEqual(out.bytes, le(w(0xeb00_0000), w(0xe12f_ff1e), w(0xe12f_ff1e), w(BASE), w(BASE + 9)));
});

test('`.4byte Func`: a resolved Thumb function value stays odd, local labels carry the Thumb bit only when typed as functions', () => {
  const text = `${PREAMBLE}\tthumb_func_start Foo
Foo:
\tbx lr
_08000002:
\tbx lr
\t.type Typed, %function
Typed:
\tbx lr
\t.align 2, 0
\t.4byte Func, Foo, _08000002, _08000002 + 1, Typed, Func - 1
`;
  const out = clean(text, { symbols: { Func: 0x0800_1235 } });
  assert.deepEqual(out.bytes.slice(8), le(w(0x0800_1235), w(BASE + 1), w(BASE + 2), w(BASE + 3), w(BASE + 5), w(0x0800_1234)));
});

test('.inst.n, .inst.w and .inst lay out their raw words; a width suffix in the wrong state is refused', () => {
  const thumb = clean('.thumb\n\t.inst.n 0x46C0 @ mov r8, r8\n\t.inst.w 0xF000F800 @ bl');
  assert.deepEqual(thumb.bytes, le(h(0x46c0), h(0xf000), h(0xf800)));
  const arm = clean('.arm\n\t.inst 0xE1A00000 @ nop', { mode: 'arm' });
  assert.deepEqual(arm.bytes, le(w(0xe1a0_0000)));

  const wrongArm = lay('.arm\n\t.inst.n 0x46C0', { mode: 'arm' });
  assert.match(wrongArm.errors[0]?.message ?? '', /ARM state/);
  const wrongThumb = lay('.thumb\n\t.inst 0xE1A00000');
  assert.match(wrongThumb.errors[0]?.message ?? '', /Thumb state/);
});

test('.incbin lays out the slice the callback returns; a missing or short read is an error', () => {
  const rom = Uint8Array.from({ length: 64 }, (_, i) => i);
  const out = clean('\t.incbin "baserom.gba", 0x10, 4\nafter: .byte 0xFF', { files: { 'baserom.gba': rom } });
  assert.deepEqual(out.bytes, Uint8Array.from([0x10, 0x11, 0x12, 0x13, 0xff]));
  assert.equal(out.labels.get('after'), BASE + 4);

  const missing = lay('\t.incbin "other.gba", 0, 4');
  assert.deepEqual(missing.errors, [{ line: 1, at: BASE, message: 'cannot read 4 bytes of "other.gba" at 0x0' }]);
  assert.equal(missing.bytes.length, 4);
  const short = lay('\t.incbin "baserom.gba", 62, 4', { files: { 'baserom.gba': rom } });
  assert.match(short.errors[0]?.message ?? '', /gave 2 bytes/);
});

test('forward and backward branches to local labels', () => {
  const out = clean(`.thumb
_back:
\tmovs r0, #0
\tbeq _fwd
\tb _back
\tbx lr
_fwd:
\tbx lr
`);
  // beq at 0x08000002 to 0x08000008: (8 - 6) / 2 = 1; b at 0x08000004 to 0x08000000: (0 - 8) / 2 = -4.
  assert.deepEqual(out.bytes, le(h(0x2000), h(0xd001), h(0xe7fc), h(0x4770), h(0x4770)));
});

test('bl reaches -4 MiB and +4 MiB - 2 and not one step further; the Thumb bit of a resolved target is dropped', () => {
  const at = BASE + 0x40_0000;
  const far = (target: number): Layout => lay('.thumb\n\tbl Far', { start: at, symbols: { Far: target } });
  const forward = at + 4 + 0x3f_fffe;
  const backward = at + 4 - 0x40_0000;
  assert.deepEqual(far(forward).bytes, le(...thumbBl(at, forward)));
  assert.deepEqual(far(forward).bytes, le(h(0xf3ff), h(0xffff)));
  assert.deepEqual(far(backward).bytes, le(h(0xf400), h(0xf800)));
  assert.deepEqual(far(forward + 1).errors, []);
  assert.deepEqual(far(forward + 1).bytes, far(forward).bytes);
  for (const target of [forward + 2, backward - 2]) {
    const out = far(target);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0]?.message ?? '', /cannot encode `bl Far`/);
    assert.equal(out.bytes.length, 4);
  }
});

test('align lengths are reported for every `.align`, including those that pad nothing', () => {
  const out = clean('.thumb\n\t.byte 1\n\t.align 2, 0\n\t.align 2\n\t.2byte 2\n\t.align 3, 0xFF\n');
  assert.deepEqual(out.bytes, Uint8Array.from([0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0xff, 0xff]));
  assert.deepEqual(out.aligns, [
    { line: 3, at: BASE + 1, length: 3 },
    { line: 4, at: BASE + 4, length: 0 },
    { line: 6, at: BASE + 6, length: 2 },
  ]);
});

test('an unfilled `.align` that pads is refused: its no-ops depend on GNU as fragment state', () => {
  const out = lay('.thumb\n\tbx lr\n\t.align 2\n\tbx lr');
  assert.equal(out.errors.length, 1);
  assert.deepEqual([out.errors[0]?.line, out.errors[0]?.at], [3, BASE + 2]);
  assert.match(out.errors[0]?.message ?? '', /without a fill byte/);
  assert.deepEqual(out.aligns, [{ line: 3, at: BASE + 2, length: 2 }]);
  assert.deepEqual(out.bytes, le(h(0x4770), h(0), h(0x4770)));
});

test('includes are laid out in place and share the labels', () => {
  const includes = {
    'asm/nonmatchings/main/Foo.s': `\tthumb_func_start Foo\nFoo:\n\tb Bar\n\tthumb_func_end Foo\n`,
    'asm/nonmatchings/main/Bar.s': `\tthumb_func_start Bar\nBar:\n\tbx lr\n\tthumb_func_end Bar\n`,
  };
  // The included files use macros the module text includes, as GNU as reads .include textually.
  const parsedIncludes = Object.fromEntries(Object.entries(includes).map(([k, v]) => [k, `.include "include/macros.inc"\n${v}`]));
  const out = clean(`${PREAMBLE}.include "asm/nonmatchings/main/Foo.s"\n.include "asm/nonmatchings/main/Bar.s"\n\t.4byte Bar`, {
    includes: parsedIncludes,
  });
  // Foo at 0x08000000 (b to 0x08000004: offset 0), Bar at 0x08000004 after `.align 2, 0` pads 2.
  assert.deepEqual(out.bytes, le(h(0xe000), h(0), h(0x4770), w(BASE + 5)));
  assert.deepEqual([...out.labels.keys()], ['Foo', 'Bar']);
});

test('include errors: unknown, a cycle, and an error inside an include names the file', () => {
  assert.deepEqual(lay('.include "nope.s"').errors, [{ line: 1, at: BASE, message: 'unknown include "nope.s"' }]);
  const cyclic = lay('.include "a.s"', { includes: { 'a.s': '.include "a.s"' } });
  assert.deepEqual(cyclic.errors, [{ line: 1, at: BASE, message: 'in "a.s": include cycle through "a.s"' }]);
  const inner = lay('.include "a.s"', { includes: { 'a.s': '\n\t.4byte nowhere' } });
  assert.deepEqual(inner.errors, [{ line: 2, at: BASE, message: 'in "a.s": undefined symbol `nowhere`' }]);
  const noCallback = layoutStatements({ statements: statementsOf('.include "a.s"'), start: BASE, mode: 'thumb', resolve: () => undefined, incbin: () => undefined });
  assert.match(noCallback.errors[0]?.message ?? '', /unknown include/);
});

test('content errors are values with line and address, and the rest still lays out', () => {
  const out = lay(`.thumb
\tbx lr
\tbl Missing
\tfrobnicate r0
\t.byte 256, 0
\t.2byte -32769
\t.4byte 0x100000000
\t.4byte gone + 4
dup: dup: bx lr
`);
  assert.deepEqual(
    out.errors.map((e) => [e.line, e.at - BASE, e.message]),
    [
      [4, 6, 'unparsable thumb instruction `frobnicate r0`'],
      [9, 20, 'symbol `dup` is already defined'],
      [3, 2, 'undefined symbol `Missing`'],
      [5, 8, 'value 256 does not fit 1 byte(s)'],
      [6, 10, 'value -32769 does not fit 2 byte(s)'],
      [7, 12, 'value 4294967296 does not fit 4 byte(s)'],
      [8, 16, 'undefined symbol `gone`'],
    ],
  );
  assert.deepEqual(out.bytes.slice(0, 2), le(h(0x4770)));
  assert.deepEqual(out.bytes.slice(-2), le(h(0x4770)));
  assert.equal(out.labels.get('dup'), BASE + 20);
});

test('negative data values wrap to their width', () => {
  assert.deepEqual(clean('.byte -1, -128\n.2byte -2\n.4byte -1, gNeg - 0x10', { symbols: { gNeg: 0x10 } }).bytes, Uint8Array.from([
    0xff, 0x80, 0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0,
  ]));
});

test('interworking: a branch across states to a function needs a veneer and is refused', () => {
  const armToThumb = lay(`.include "include/macros.inc"\n\tthumb_func_start T\nT: bx lr\n.arm\n\tbl T`);
  assert.match(armToThumb.errors[0]?.message ?? '', /ARM branch to the Thumb function `T`/);
  const armToResolved = lay('.arm\n\tbl Ext', { mode: 'arm', symbols: { Ext: 0x0800_1001 } });
  assert.match(armToResolved.errors[0]?.message ?? '', /ARM branch to the Thumb function `Ext`/);
  const thumbToArm = lay(`.include "include/macros.inc"\n\tarm_func_start A\nA: bx lr\n.thumb\n\tbl A`);
  assert.match(thumbToArm.errors[0]?.message ?? '', /Thumb branch to the ARM function `A`/);
  // An ARM pc-relative load keeps an odd value: only branches drop the Thumb bit.
  const ldr = clean('.arm\n\tldr r0, Odd', { mode: 'arm', symbols: { Odd: BASE + 0x11 } });
  assert.deepEqual(ldr.bytes, le(w(0xe59f_0009)));
});

test('an instruction at an address its state cannot hold is refused', () => {
  const arm = lay('.arm\n\t.byte 0\n\tbx lr', { mode: 'arm' });
  assert.deepEqual(arm.errors, [{ line: 3, at: BASE + 1, message: 'arm instruction at an unaligned address' }]);
  assert.equal(arm.end, BASE + 5);
});

test('a memo shared across layouts changes no byte: texts naming no symbol are reused, named ones are not', () => {
  const text = `.thumb
push {lr}
adds r0, r1, #0
ldr r0, Far
bl Callee
lsls r1, r0, #3
pop {r0}
bx r0
`;
  const memo = layoutMemo();
  const cases: readonly Options[] = [
    { start: BASE + 0x100, symbols: { Far: BASE + 0x200, Callee: BASE + 0x400 } },
    { start: BASE + 0x102, symbols: { Far: BASE + 0x204, Callee: BASE + 0x80 } },
    { start: BASE + 0x104, symbols: { Far: BASE + 0x10c, Callee: BASE + 0x1000 } },
    { start: BASE + 0x100, symbols: { Far: BASE + 0x3fc, Callee: BASE + 0x100 } },
  ];
  for (const options of cases) {
    const alone = clean(text, options);
    const shared = clean(text, { ...options, memo });
    assert.deepEqual(shared.bytes, alone.bytes, `start 0x${(options.start ?? BASE).toString(16)}`);
  }
  // The named texts (`ldr r0, Far`, `bl Callee`) stay out of the word memo; the others are in it once per word alignment.
  assert.ok([...memo.words.keys()].every((key) => !key.includes('Far') && !key.includes('Callee')));
  assert.ok(memo.words.has('t0push {lr}') && memo.words.has('t2push {lr}'));
  // An unparsable or unencodable text is refused with or without the memo.
  const bad = lay('.thumb\nadds r0, #999\n', { memo });
  assert.deepEqual(
    bad.errors.map((e) => e.message),
    lay('.thumb\nadds r0, #999\n').errors.map((e) => e.message),
  );
  assert.ok(bad.errors.length > 0);
});

test('a PC-relative load or adr naming a symbol of another object is refused; a branch or a data word is not', () => {
  const text = '.thumb\nldr r0, Pool\nbl Callee\n.4byte Pool\n.align 2, 0\nadr r1, Pool\n';
  const symbols = { Pool: BASE + 0x40, Callee: BASE + 0x201 };
  clean(text, { symbols });
  clean(text, { symbols, sameObject: (name) => name === 'Pool' });
  const out = lay(text, { symbols, sameObject: (name) => name !== 'Pool' });
  assert.deepEqual(
    out.errors.map((e) => [e.line, e.at - BASE, e.message]),
    [
      [2, 0, '`ldr r0, Pool` reaches `Pool` PC-relatively in another object, which `as` cannot relocate'],
      [6, 0xc, '`adr r1, Pool` reaches `Pool` PC-relatively in another object, which `as` cannot relocate'],
    ],
  );
});
