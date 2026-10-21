// buildModel end to end on hand-made analyses (architecture §3.4, §6.2, §6.7, D46): the functions with where
// their names and extents came from, confirm-mode findings, runs_at plumbing (identity in phase 3, and a moved
// run address), determinism whatever the config's map order, diagnostics sorted, never a throw for content.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { itemAt } from '../../../src/core/model/item-table.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith, thumbAt, tiles, words } from '../layout/hand-made.ts';

const ROM = romWith([], { size: 0x400 });

test('the model of a config: schema, ROM, build name, functions with the sources of their names and extents', () => {
  const analysis = analysisOf(ROM, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x120 }), fact({ entry: BASE + 0x108, end: BASE + 0x110 })],
    overrides: [{ span: { start: BASE + 0x140, end: BASE + 0x150 }, kind: 'code' }],
  });
  const config = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x180, kind: 'data', generated: true }],
    functions: [
      [BASE + 0x100, { name: 'Main', from: 'legacy' }],
      [BASE + 0x108, { name: 'sub_08000108', label: true }],
      [BASE + 0x130, { name: 'Sized', size: 6 }],
      [BASE + 0x144, 'Overridden'],
      [BASE + 0x160, { name: 'Listed', mode: 'arm' }],
    ],
  });
  const model = buildModel(ROM, analysis, config);
  assert.equal(model.schema, 'romlift/model@1');
  assert.deepEqual(model.rom, { sha1: ROM.sha1, end: ROM.end });
  assert.deepEqual(model.build, { name: 'test' });
  assert.deepEqual(model.unlisted, []);
  assert.deepEqual(
    model.functions.map((f) => [f.entry - BASE, f.extent.start - BASE, f.extent.end - BASE, f.mode, f.name, f.source.name, f.source.extent]),
    [
      [0x100, 0x100, 0x120, 'thumb', 'Main', { kind: 'toml', from: 'legacy' }, 'analysis'],
      [0x108, 0x108, 0x110, 'thumb', 'sub_08000108', { kind: 'default' }, 'analysis'],
      [0x130, 0x130, 0x136, 'thumb', 'Sized', { kind: 'toml' }, 'toml-size'],
      [0x144, 0x144, 0x150, 'thumb', 'Overridden', { kind: 'toml' }, 'override'],
      [0x160, 0x160, 0x180, 'arm', 'Listed', { kind: 'toml' }, 'next-listed'],
    ],
  );
  assert.deepEqual(
    model.chunks.filter((c) => c.kind === 'function').map((c) => [c.name, c.span.start - BASE, c.span.end - BASE]),
    [
      ['Main', 0x100, 0x120],
      ['Sized', 0x130, 0x136],
      ['Overridden', 0x144, 0x150],
      ['Listed', 0x160, 0x180],
    ],
  );
  assert.ok(tiles(model.items, ROM.base, ROM.end));
});

test('a confirm result carries its unlisted findings; a listed entry the analysis did not accept still gets its chunk', () => {
  const base = analysisOf(ROM, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 })],
    seeds: [
      { entry: BASE + 0x100, mode: 'thumb', rule: 'seed.listed' },
      { entry: BASE + 0x120, mode: 'thumb', rule: 'seed.listed' },
    ],
  });
  if (base.mode !== 'confirm') throw new Error('confirm');
  const unlisted = [{ entry: BASE + 0x200, mode: 'thumb' as const, origin: 'call' as const, provenance: { rule: 'seed.call' as const, round: 1, cites: [BASE + 0x104] } }];
  const analysis = { ...base, unlisted };
  const model = buildModel(ROM, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'A'], [BASE + 0x120, 'B']] }));
  assert.deepEqual(model.unlisted, unlisted);
  assert.deepEqual(model.diagnostics, []);
  const b = model.chunks.find((c) => c.name === 'B');
  assert.deepEqual([b?.kind, b?.span.start, b?.span.end], ['function', BASE + 0x120, ROM.end]);
  assert.equal(model.functions.find((f) => f.name === 'B')?.source.extent, 'next-listed');
});

/** A function copied to IWRAM: load 0x140, run 0x03000000, with a pool load and a branch inside. */
function ramCode() {
  const code = thumbAt(0x0300_0000)`
    push {lr}
    ldr r0, _0300000C
    b _03000008
    mov r8, r8
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x140, bytes: code }, { at: BASE + 0x14c, bytes: words(0x1234_5678) }], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x140, end: BASE + 0x150, code: [{ start: BASE + 0x140, end: BASE + 0x14c }], pools: [BASE + 0x14c] })] });
  const config = (runsAt: number): RomliftConfig =>
    configOf({
      modules: [['rom_header', BASE], ['main', HEADER_END], ['iwram', BASE + 0x140], { name: 'data', start: BASE + 0x150, kind: 'data', generated: true }],
      functions: [[BASE + 0x140, 'RamFunc']],
      overrides: [{ start: BASE + 0x140, size: 0x10, kind: 'code', runsAt }],
    });
  return { rom, analysis, config };
}

test('runs_at plumbing: identity in phase 3 sets runAt on the module, its chunks and functions, and moves no label', () => {
  const { rom, analysis, config } = ramCode();
  const model = buildModel(rom, analysis, config(BASE + 0x140));
  const iwram = model.modules.find((m) => m.name === 'iwram');
  assert.equal(iwram?.runAt, BASE + 0x140);
  assert.equal(model.chunks.find((c) => c.name === 'RamFunc')?.runAt, BASE + 0x140);
  assert.equal(model.functions[0]?.runAt, BASE + 0x140);
  assert.equal(model.chunks.find((c) => c.module === 'main')?.runAt, undefined);
  assert.deepEqual(model.labels.filter((l) => l.addr >= BASE + 0x140 && l.addr < BASE + 0x150).map((l) => [l.name, l.addr - BASE]), [
    ['RamFunc', 0x140],
    ['_08000148', 0x148],
    ['_0800014C', 0x14c],
  ]);
});

test('runs_at plumbing: a moved run address puts the labels at run addresses and decodes the items there', () => {
  const { rom, analysis, config } = ramCode();
  const model = buildModel(rom, analysis, config(0x0300_0000));
  assert.deepEqual(model.diagnostics.map((d) => d.code), []);
  assert.equal(model.modules.find((m) => m.name === 'iwram')?.runAt, 0x0300_0000);
  const chunk = model.chunks.find((c) => c.name === 'RamFunc');
  assert.equal(chunk?.runAt, 0x0300_0000);
  assert.deepEqual(model.labels.filter((l) => l.addr >= 0x0300_0000 && l.addr < 0x0300_0010).map((l) => [l.name, l.addr, l.scope]), [
    ['RamFunc', 0x0300_0000, 'module'],
    ['_08000148', 0x0300_0008, 'module'],
    ['_0800014C', 0x0300_000c, 'module'],
  ]);
  if (chunk === undefined || chunk.runAt === undefined) throw new Error('no chunk');
  const items = Array.from({ length: chunk.items.count }, (_, i) => itemAt(model.items, chunk.items.first + i, rom, (chunk.runAt ?? 0) - chunk.span.start));
  assert.deepEqual(items.map((i) => [i.kind, i.span.start - BASE, i.kind === 'insn' ? i.insn.addr : 0]), [
    ['insn', 0x140, 0x0300_0000],
    ['insn', 0x142, 0x0300_0002],
    ['insn', 0x144, 0x0300_0004],
    ['insn', 0x146, 0x0300_0006],
    ['insn', 0x148, 0x0300_0008],
    ['insn', 0x14a, 0x0300_000a],
    ['pool', 0x14c, 0],
  ]);
});

test('a runs_at range off the module borders is E_OVERRIDE_INVALID; the model is still built', () => {
  const { rom, analysis } = ramCode();
  const bad = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x150, kind: 'data', generated: true }],
    functions: [[BASE + 0x140, 'RamFunc']],
    overrides: [{ start: BASE + 0x140, size: 0x10, kind: 'code', runsAt: 0x0300_0000 }],
  });
  const model = buildModel(rom, analysis, bad);
  assert.deepEqual(model.diagnostics.map((d) => d.code), ['E_OVERRIDE_INVALID']);
  assert.ok(model.modules.every((m) => m.runAt === undefined));
  assert.ok(tiles(model.items, rom.base, rom.end));
});

test('deterministic: the same model whatever order the config maps were filled in; diagnostics sorted by address', () => {
  const analysis = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 }), fact({ entry: BASE + 0x110, end: BASE + 0x120 })] });
  const modules = [['rom_header', BASE], ['main', HEADER_END], ['late', BASE + 0x104], ['later', BASE + 0x10a]] as const;
  const forward = configOf({ modules, functions: [[BASE + 0x100, 'A'], [BASE + 0x110, 'B']] });
  const backward = configOf({ modules, functions: [[BASE + 0x110, 'B'], [BASE + 0x100, 'A']] });
  const a = buildModel(ROM, analysis, forward);
  assert.deepEqual(buildModel(ROM, analysis, backward), a);
  assert.deepEqual(a.diagnostics.map((d) => [d.code, d.addr]), [
    ['E_MODULE_BORDER', BASE + 0x104],
    ['E_MODULE_BORDER', BASE + 0x10a],
  ]);
});

test('an [[overrides]] range reaching outside the ROM is W_OVERRIDE_OUTSIDE_ROM, a [functions] entry outside it W_FUNCTION_OUTSIDE_ROM (architecture-r1-14)', () => {
  const analysis = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 })] });
  const config = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END]],
    functions: [[BASE + 0x100, 'A'], [0x0900_0000, 'Outside']],
    overrides: [{ start: BASE + 0x3f0, size: 0x20, kind: 'data' }],
  });
  const model = buildModel(ROM, analysis, config);
  assert.deepEqual(model.diagnostics.map((d) => [d.code, d.addr ?? d.span?.start]), [
    ['W_OVERRIDE_IGNORED', BASE + 0x3f0],
    ['W_OVERRIDE_OUTSIDE_ROM', BASE + 0x3f0],
    ['W_FUNCTION_OUTSIDE_ROM', 0x0900_0000],
  ]);
  assert.match(model.diagnostics.find((d) => d.code === 'W_OVERRIDE_OUTSIDE_ROM')?.message ?? '', /the \[\[overrides\]\] range 0x080003F0\.\.0x08000410 reaches outside the ROM/);
});

test('an [[overrides]] entry without runs_at that changes nothing is W_OVERRIDE_IGNORED; a code override that gives a listed extent is not (fix round 5, correctness-b0-3)', () => {
  const analysis = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 })] });
  const ignored = (overrides: NonNullable<Parameters<typeof configOf>[0]['overrides']>, functions: NonNullable<Parameters<typeof configOf>[0]['functions']> = [[BASE + 0x100, 'A']]): readonly string[] =>
    buildModel(ROM, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions, overrides })).diagnostics.filter((d) => d.code === 'W_OVERRIDE_IGNORED').map((d) => d.message);
  assert.equal(ignored([{ start: BASE + 0x100, size: 0x10, kind: 'data' }]).length, 1, 'a data override');
  assert.match(ignored([{ start: BASE + 0x100, size: 0x10, kind: 'code', mode: 'thumb' }])[0] ?? '', /changes nothing: it gives the extent only of a listed function the analysis did not find/);
  // A listed entry the analysis did not find, inside a code override the run read: its extent comes from the override.
  const override = { start: BASE + 0x120, size: 0x10, kind: 'code' as const, mode: 'thumb' as const };
  const read = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 })], overrides: [{ span: { start: override.start, end: override.start + override.size }, kind: 'code', mode: 'thumb' }] });
  const used = buildModel(ROM, read, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'A'], [BASE + 0x120, 'Unfound']], overrides: [override] }));
  assert.deepEqual(used.diagnostics.filter((d) => d.code === 'W_OVERRIDE_IGNORED'), []);
  // A range wholly outside the ROM is W_OVERRIDE_OUTSIDE_ROM's alone (fix round 6, architecture-b1-2).
  const outside = buildModel(ROM, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'A']], overrides: [{ start: 0x0900_0000, size: 4, kind: 'code', mode: 'thumb' }] }));
  assert.deepEqual(outside.diagnostics.map((d) => d.code), ['W_OVERRIDE_OUTSIDE_ROM']);
});

test('never a throw for content: no module, a function outside the ROM, a symbol in RAM', () => {
  const analysis = analysisOf(ROM, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 })] });
  const model = buildModel(ROM, analysis, configOf({ modules: [], functions: [[BASE + 0x100, 'A'], [0x0900_0000, 'Outside']], symbols: [[0x0300_0000, { name: 'gRam', aliases: [] }]] }));
  assert.deepEqual(model.diagnostics.map((d) => [d.code, d.addr]), [['E_MODULE_ORDER', BASE], ['W_FUNCTION_OUTSIDE_ROM', 0x0900_0000]]);
  assert.match(model.diagnostics[1]?.message ?? '', /0x09000000 \(Outside\) lies outside the ROM/);
  assert.deepEqual(model.functions.map((f) => f.name), ['A']);
  assert.deepEqual(model.symbols, [{ addr: 0x0300_0000, name: 'gRam' }]);
  assert.ok(tiles(model.items, ROM.base, ROM.end));
});

test('a [symbols] entry inside an instruction gets no label and W_SYMBOL_UNPLACED; one at an item start is a data label', () => {
  const rom = romWith([{ at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; pop {r0}; bx r0` }, { at: BASE + 0x108, bytes: words(BASE + 0x101) }], { size: 0x400 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x106 })] });
  const config = configOf({
    modules: [['rom_header', BASE], ['main', HEADER_END]],
    functions: [[BASE + 0x100, 'A']],
    symbols: [
      [BASE + 0x101, { name: 'gOdd', aliases: [] }],
      [BASE + 0x102, { name: 'gAtPop', aliases: [] }],
    ],
  });
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(model.labels.filter((l) => l.name.startsWith('g')).map((l) => [l.name, l.addr - BASE, l.kind]), [['gAtPop', 0x102, 'data']]);
  assert.deepEqual(model.diagnostics.filter((d) => d.code === 'W_SYMBOL_UNPLACED').map((d) => d.addr), [BASE + 0x101]);
  assert.deepEqual(model.symbols.map((s) => s.name), ['gOdd', 'gAtPop']);
});
