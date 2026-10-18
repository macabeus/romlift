// The model's chunks (architecture §6.2; the PoC's tile()): the header chunk clipping the cartridge entry
// (correctness-6), startup chunks over the startup region, one function chunk per listed entry that is not a
// label, label entries as inner labels, orphan chunks unk_<ADDR> for the bytes between, never across a module
// border, and data chunks split at symbols.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeEntries } from '../../../src/core/layout/borders.ts';
import { planChunks } from '../../../src/core/model/chunks.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { planModules } from '../../../src/core/model/modules.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith } from '../layout/hand-made.ts';

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
