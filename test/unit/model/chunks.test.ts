// The model's chunks (architecture §6.2; the PoC's tile()): the header chunk clipping the cartridge entry
// (correctness-6), startup chunks over the startup region, one function chunk per listed entry that is not a
// label, label entries as inner labels, orphan chunks unk_<ADDR> for the bytes between, never across a module
// border, data chunks split at symbols, and a padding-only orphan folded into the function after it (the owner's
// answer to Q5 b of phase 3), with each case that stays an orphan.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeEntries } from '../../../src/core/layout/entries.ts';
import { chunkEntry, planChunks } from '../../../src/core/model/chunks.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { planModules } from '../../../src/core/model/modules.ts';
import { ItemKind } from '../../../src/core/model/types.ts';
import type { Model } from '../../../src/core/model/types.ts';
import type { Addr } from '../../../src/foundation/rom/span.ts';
import type { ConfigSpec, FactSpec } from '../layout/hand-made.ts';
import { analysisOf, armAt, BASE, configOf, fact, HEADER_END, romWith, thumbAt } from '../layout/hand-made.ts';

const ROM = romWith([], { size: 0x400 });

function analysis() {
  return analysisOf(ROM, {
    functions: [
      fact({ entry: BASE, end: BASE + 0xe0, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }] }),
      fact({ entry: HEADER_END, end: BASE + 0xda, mode: 'arm' }),
      fact({ entry: BASE + 0x100, end: BASE + 0x120 }),
      fact({ entry: BASE + 0x110, end: BASE + 0x118 }),
      fact({ entry: BASE + 0x124, end: BASE + 0x130 }),
    ],
    startupEnd: BASE + 0xdc,
  });
}

const DEFAULT_MODULES: readonly (readonly [string, number])[] = [['rom_header', BASE], ['crt0', HEADER_END], ['main', BASE + 0xdc], ['data', BASE + 0x130]];

function config(modules: readonly (readonly [string, number])[] = DEFAULT_MODULES) {
  return configOf({
    modules: modules.map(([name, start]) => (name === 'data' ? { name, start, kind: 'data' as const, generated: true } : ([name, start] as const))),
    functions: [
      [BASE, { name: 'Start', mode: 'arm' }],
      [HEADER_END, { name: 'Init', mode: 'arm' }],
      [BASE + 0x100, 'Main'],
      [BASE + 0x110, { name: 'MainInner', label: true }],
      [BASE + 0x124, 'Next'],
    ],
    symbols: [
      [BASE + 0x200, { name: 'gTable', aliases: [] }],
      [0x0300_0000, { name: 'gRam', aliases: [] }],
    ],
  });
}

test('the header chunk clips the cartridge entry; startup, function, orphan and data chunks tile the ROM', () => {
  const model = buildModel(ROM, analysis(), config());
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.chunks.map((c) => [c.kind, c.name, c.module, c.span.start - BASE, c.span.end - BASE, c.mode]),
    [
      ['header', 'rom_header', 'rom_header', 0, 0xc0, null],
      ['startup', 'Init', 'crt0', 0xc0, 0xda, 'arm'],
      ['startup', 'unk_080000DA', 'crt0', 0xda, 0xdc, 'thumb'],
      ['orphan', 'unk_080000DC', 'main', 0xdc, 0x100, 'thumb'],
      ['function', 'Main', 'main', 0x100, 0x120, 'thumb'],
      ['orphan', 'unk_08000120', 'main', 0x120, 0x124, 'thumb'],
      ['function', 'Next', 'main', 0x124, 0x130, 'thumb'],
      ['data', 'gUnk_08000130', 'data', 0x130, 0x200, null],
      ['data', 'gTable', 'data', 0x200, 0x400, null],
    ],
  );
  const inner = (name: string) => model.chunks.find((c) => c.name === name)?.innerLabels.map((l) => [l.name, l.addr - BASE, l.kind, l.thumb]);
  assert.deepEqual(inner('rom_header'), [['Start', 0, 'func', false]], 'the cartridge entry is a label of the header chunk');
  assert.deepEqual(inner('Main'), [['MainInner', 0x110, 'func', true]], 'a label entry is an inner label, not a chunk');
  assert.deepEqual(inner('Next'), []);
  assert.deepEqual(model.modules.map((m) => [m.name, m.chunks.first, m.chunks.count]), [
    ['rom_header', 0, 1],
    ['crt0', 1, 2],
    ['main', 3, 4],
    ['data', 7, 2],
  ]);
});

test('a chunk never crosses a module border: a function cut by a moved border leaves an orphan in the next module', () => {
  const a = analysis();
  const c = config([['rom_header', BASE], ['crt0', HEADER_END], ['main', BASE + 0xdc], ['moved', BASE + 0x108], ['data', BASE + 0x130]]);
  const { modules } = planModules(ROM, c, []);
  const functions = new Map([...c.functions].filter(([, f]) => f.label !== true));
  const entries = placeEntries([...functions.keys()].map((entry) => ({ entry, label: false })), a);
  const chunks = planChunks({ rom: ROM, modules, entries, functions, headerEnd: HEADER_END, startupEnd: BASE + 0xdc, symbols: [] });
  assert.deepEqual(
    chunks.filter((x) => x.span.start >= BASE + 0x100 && x.span.start < BASE + 0x130).map((x) => [x.kind, x.name, x.module, x.span.start - BASE, x.span.end - BASE]),
    [
      ['function', 'Main', 2, 0x100, 0x108],
      ['orphan', 'unk_08000108', 3, 0x108, 0x124],
      ['function', 'Next', 3, 0x124, 0x130],
    ],
  );
});

test('a data module is one chunk per symbol start inside it; a symbol outside the ROM splits nothing', () => {
  const model = buildModel(ROM, analysis(), config());
  const data = model.chunks.filter((c) => c.kind === 'data');
  assert.deepEqual(data.map((c) => [c.name, c.span.start - BASE]), [
    ['gUnk_08000130', 0x130],
    ['gTable', 0x200],
  ]);
  assert.deepEqual(model.symbols, [
    { addr: 0x0300_0000, name: 'gRam' },
    { addr: BASE + 0x200, name: 'gTable' },
  ]);
});

test('without a startup region there are no startup chunks; a function with an empty extent is at least 2 bytes', () => {
  const a = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x100, code: [] }), fact({ entry: BASE + 0x108, end: BASE + 0x110 })] });
  const model = buildModel(ROM, a, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'Tiny'], [BASE + 0x108, 'Other']] }));
  assert.deepEqual(model.diagnostics.map((d) => d.code), []);
  assert.deepEqual(
    model.chunks.map((c) => [c.kind, c.name, c.span.start - BASE, c.span.end - BASE]),
    [
      ['header', 'rom_header', 0, 0xc0],
      ['orphan', 'unk_080000C0', 0xc0, 0x100],
      ['function', 'Tiny', 0x100, 0x102],
      ['orphan', 'unk_08000102', 0x102, 0x108],
      ['function', 'Other', 0x108, 0x110],
      ['data', 'gUnk_08000110', 0x110, 0x400],
    ],
  );
});

// ---------------------------------------------------------------------------------------------------
// Padding-only orphans folded into the next function (phase-3.md Q5 b, D68 e).

/** A ROM of A (Thumb, 10 bytes at 0x100), a pad of `pad` (zeros by default) at 0x10A and B (Thumb) at 0x10C. */
function padRom(pad: readonly number[] = [0, 0], b: Uint8Array = thumbAt(BASE + 0x10c)`movs r0, #1; bx lr`) {
  return romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; bl _0800010C; movs r0, #0; pop {pc}` },
      { at: BASE + 0x10a, bytes: Uint8Array.from(pad) },
      { at: BASE + 0x10c, bytes: b },
    ],
    { size: 0x400 },
  );
}

interface PadCase {
  readonly rom?: ReturnType<typeof romWith>;
  readonly facts?: readonly FactSpec[];
  readonly modules?: ConfigSpec['modules'];
  readonly functions?: ConfigSpec['functions'];
  readonly symbols?: ConfigSpec['symbols'];
  readonly startupEnd?: Addr;
}

/** The model of a pad case: A [0x100, 0x10A) and B [0x10C, 0x110) unless the case says otherwise. */
function padModel(c: PadCase = {}): Model {
  const rom = c.rom ?? padRom();
  const facts = c.facts ?? [{ entry: BASE + 0x100, end: BASE + 0x10a }, { entry: BASE + 0x10c, end: BASE + 0x110 }];
  const a = analysisOf(rom, { functions: facts.map(fact), ...(c.startupEnd === undefined ? {} : { startupEnd: c.startupEnd }) });
  const modules = c.modules ?? [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }];
  return buildModel(rom, a, configOf({ modules, functions: c.functions ?? [[BASE + 0x100, 'A'], [BASE + 0x10c, 'B']], ...(c.symbols === undefined ? {} : { symbols: c.symbols }) }));
}

/** [kind, name, start, end] of the chunks of [0x100, 0x110), offsets from BASE. */
function around(model: Model): readonly (readonly [string, string, number, number])[] {
  return model.chunks.filter((c) => c.span.end > BASE + 0x100 && c.span.start < BASE + 0x110).map((c) => [c.kind, c.name, c.span.start - BASE, c.span.end - BASE] as const);
}

test('a 2-byte zero pad before a word-aligned Thumb entry folds into that function: its span opens with the pad, entry and name unchanged', () => {
  const model = padModel();
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(around(model), [
    ['function', 'A', 0x100, 0x10a],
    ['function', 'B', 0x10a, 0x110],
  ]);
  const b = model.chunks.find((c) => c.name === 'B');
  assert.ok(b !== undefined);
  assert.equal(chunkEntry(b), BASE + 0x10c, 'the entry stays');
  assert.equal(chunkEntry(model.chunks.find((c) => c.name === 'A') ?? b), BASE + 0x100);
  const first = b.items.first;
  assert.deepEqual([model.items.kind[first], model.items.start[first], model.items.length[first]], [ItemKind.padding, BASE + 0x10a, 2], 'its first item is the padding item');
  assert.equal(model.items.start[first + 1], BASE + 0x10c);
  assert.deepEqual(model.functions.find((f) => f.name === 'B')?.entry, BASE + 0x10c);
  assert.equal(model.labels.some((l) => l.name === 'unk_0800010A'), false, 'no orphan label');
  assert.deepEqual(model.labels.filter((l) => l.name === 'B').map((l) => l.addr), [BASE + 0x10c], 'the label stays at the entry');
});

test('a 1-byte and a 3-byte zero pad fold; an ARM function folds too (arm_func_start aligns)', () => {
  const one = padModel({ facts: [{ entry: BASE + 0x100, end: BASE + 0x10b }, { entry: BASE + 0x10c, end: BASE + 0x110 }] });
  assert.deepEqual(around(one), [
    ['function', 'A', 0x100, 0x10b],
    ['function', 'B', 0x10b, 0x110],
  ]);
  const short = romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; bl _0800010C; pop {pc}` },
      { at: BASE + 0x108, bytes: Uint8Array.from([1]) },
      { at: BASE + 0x10c, bytes: thumbAt(BASE + 0x10c)`movs r0, #1; bx lr` },
    ],
    { size: 0x400 },
  );
  const three = padModel({ rom: short, facts: [{ entry: BASE + 0x100, end: BASE + 0x109 }, { entry: BASE + 0x10c, end: BASE + 0x110 }] });
  assert.deepEqual(around(three), [
    ['function', 'A', 0x100, 0x109],
    ['function', 'B', 0x109, 0x110],
  ]);
  const arm = padModel({
    rom: padRom([0, 0], armAt(BASE + 0x10c)`bx lr`),
    facts: [{ entry: BASE + 0x100, end: BASE + 0x10a }, { entry: BASE + 0x10c, end: BASE + 0x110, mode: 'arm' }],
    functions: [[BASE + 0x100, 'A'], [BASE + 0x10c, { name: 'B', mode: 'arm' }]],
  });
  assert.deepEqual(around(arm), [
    ['function', 'A', 0x100, 0x10a],
    ['function', 'B', 0x10a, 0x110],
  ]);
});

test('never folded: a non-zero pad (0x46C0), a 4-byte pad, a pad before an entry at 2 mod 4', () => {
  assert.deepEqual(around(padModel({ rom: padRom([0xc0, 0x46]) })), [
    ['function', 'A', 0x100, 0x10a],
    ['orphan', 'unk_0800010A', 0x10a, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
  assert.deepEqual(around(padModel({ facts: [{ entry: BASE + 0x100, end: BASE + 0x108 }, { entry: BASE + 0x10c, end: BASE + 0x110 }] })), [
    ['function', 'A', 0x100, 0x108],
    ['orphan', 'unk_08000108', 0x108, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
  const unaligned = padModel({
    facts: [{ entry: BASE + 0x100, end: BASE + 0x108 }, { entry: BASE + 0x10a, end: BASE + 0x110 }],
    functions: [[BASE + 0x100, 'A'], [BASE + 0x10a, 'B']],
  });
  assert.deepEqual(around(unaligned), [
    ['function', 'A', 0x100, 0x108],
    ['orphan', 'unk_08000108', 0x108, 0x10a],
    ['function', 'B', 0x10a, 0x110],
  ]);
});

test('a pad before a module border, or at a code module\'s end before data, is the last item of the chunk before it (D75 d)', () => {
  const border = padModel({ modules: [['rom_header', BASE], ['main', HEADER_END], ['next', BASE + 0x10c], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }] });
  assert.deepEqual(border.diagnostics, []);
  assert.deepEqual(around(border), [
    ['function', 'A', 0x100, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
  assert.deepEqual(border.chunks.filter((c) => c.name === 'A' || c.name === 'B').map((c) => [c.module, c.entry]), [['main', undefined], ['next', undefined]]);
  const a = border.chunks.find((c) => c.name === 'A') ?? assert.fail('A');
  const last = a.items.first + a.items.count - 1;
  assert.deepEqual([border.items.kind[last], (border.items.start[last] ?? 0) - BASE, border.items.length[last]], [ItemKind.padding, 0x10a, 2], 'the pad is A\'s last item, a padding item');
  const atEnd = padModel({ facts: [{ entry: BASE + 0x100, end: BASE + 0x10a }], functions: [[BASE + 0x100, 'A']], modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x10c, kind: 'data', generated: true }] });
  assert.deepEqual(around(atEnd), [
    ['function', 'A', 0x100, 0x10c],
    ['data', 'gUnk_0800010C', 0x10c, 0x400],
  ]);
});

test('at a c module\'s end, a pad after a function stays its own orphan, with its own stub (D78 b)', () => {
  // A decompiled last function ends its C object, which gas pads with a nop (0x46C0), so the zeros stay assembly.
  const cBorder = padModel({ modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'c', generated: true }, ['next', BASE + 0x10c], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }] });
  assert.deepEqual(cBorder.diagnostics, []);
  assert.deepEqual(around(cBorder), [
    ['function', 'A', 0x100, 0x10a],
    ['orphan', 'unk_0800010A', 0x10a, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
  const cAtEnd = padModel({ facts: [{ entry: BASE + 0x100, end: BASE + 0x10a }], functions: [[BASE + 0x100, 'A']], modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'c', generated: true }, { name: 'data', start: BASE + 0x10c, kind: 'data', generated: true }] });
  assert.deepEqual(around(cAtEnd), [
    ['function', 'A', 0x100, 0x10a],
    ['orphan', 'unk_0800010A', 0x10a, 0x10c],
    ['data', 'gUnk_0800010C', 0x10c, 0x400],
  ]);
});

test('never folded: a pad inside the startup region', () => {
  const startup = padModel({ startupEnd: BASE + 0x10c, modules: [['rom_header', BASE], ['crt0', HEADER_END], ['main', BASE + 0x10c], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }] });
  assert.deepEqual(around(startup), [
    ['startup', 'A', 0x100, 0x10a],
    ['startup', 'unk_0800010A', 0x10a, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
  const inStartup = padModel({ startupEnd: BASE + 0x110, modules: [['rom_header', BASE], ['crt0', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }] });
  assert.deepEqual(
    around(inStartup).map((c) => c[0]),
    ['startup', 'startup', 'startup'],
    'a startup function after a pad keeps its own chunk',
  );
});

test('never folded: a pad holding a listed label entry or a [symbols] entry, each of which needs a label there', () => {
  const labelled = padModel({ functions: [[BASE + 0x100, 'A'], [BASE + 0x10a, { name: 'Mid', label: true }], [BASE + 0x10c, 'B']] });
  assert.deepEqual(around(labelled).map((c) => c[1]), ['A', 'unk_0800010A', 'B']);
  assert.deepEqual(labelled.chunks.find((c) => c.name === 'unk_0800010A')?.innerLabels.map((l) => l.name), ['Mid'], 'the label entry stays in the orphan');
  const symbol = padModel({ symbols: [[BASE + 0x10a, { name: 'gPad', aliases: [] }]] });
  assert.deepEqual(around(symbol), [
    ['function', 'A', 0x100, 0x10a],
    ['orphan', 'unk_0800010A', 0x10a, 0x10c],
    ['function', 'B', 0x10c, 0x110],
  ]);
});

test('a label inside a folded pad (a branch target no extent covers) turns the pad into data the printer places', () => {
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; beq _0800010A; bl _0800010C; pop {pc}` },
      { at: BASE + 0x10c, bytes: thumbAt(BASE + 0x10c)`movs r0, #1; bx lr` },
    ],
    { size: 0x400 },
  );
  const model = padModel({ rom });
  assert.deepEqual(around(model), [
    ['function', 'A', 0x100, 0x10a],
    ['function', 'B', 0x10a, 0x110],
  ]);
  const b = model.chunks.find((c) => c.name === 'B');
  assert.ok(b !== undefined);
  assert.deepEqual([model.items.kind[b.items.first], model.items.length[b.items.first]], [ItemKind.data, 2]);
  assert.ok(model.labels.some((l) => l.name === '_0800010A'));
});
