// The model's labels (architecture §5, §6.2 step 4): func labels with the config's names, pool labels at pool
// words, table labels, local labels at targets no other label names, gUnk_ data labels where a pool word points
// into a data module, chunk labels; scope 'global' when another module references the label (a call, a pool word in
// its Thumb form, ...), and for a function whose name no other module defines (D111).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printChunk } from '../../../src/core/emit/print/chunk.ts';
import { codeRefs } from '../../../src/core/model/labels.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { segmentsOf } from '../../../src/core/model/segments.ts';
import { ITEM_RAW_REASONS, ItemKind } from '../../../src/core/model/types.ts';
import {
  BASE,
  HEADER_END,
  analysisOf,
  armAt,
  configOf,
  fact,
  romWith,
  rows,
  thumbAt,
  words,
} from '../layout/hand-made.ts';

function scene(poolValue = BASE + 0x121) {
  const f = thumbAt(BASE + 0x100)`
    push {lr}
    bl _08000120
    ldr r0, _0800010C
    pop {r1}
    bx r1
  `;
  const g = thumbAt(BASE + 0x120)`
    push {lr}
    ldr r0, _0800012C
    b _08000128
    mov r8, r8
    pop {r0}
    bx r0
  `;
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: f },
      { at: BASE + 0x10c, bytes: words(poolValue) },
      { at: BASE + 0x120, bytes: g },
      { at: BASE + 0x12c, bytes: words(BASE + 0x180) },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(rom, {
    functions: [
      fact({
        entry: BASE + 0x100,
        end: BASE + 0x110,
        code: [{ start: BASE + 0x100, end: BASE + 0x10c }],
        pools: [BASE + 0x10c],
      }),
      fact({
        entry: BASE + 0x120,
        end: BASE + 0x130,
        code: [{ start: BASE + 0x120, end: BASE + 0x12c }],
        pools: [BASE + 0x12c],
      }),
    ],
  });
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['a', HEADER_END],
      ['b', BASE + 0x120],
      { name: 'data', start: BASE + 0x130, kind: 'data', generated: true },
    ],
    functions: [
      [BASE + 0x100, 'F'],
      [BASE + 0x120, 'G'],
    ],
  });
  return { rom, analysis, config };
}

test('codeRefs: every branch, bl and pool load of the code, at its site', () => {
  const { rom, analysis } = scene();
  const refs = codeRefs(rom, segmentsOf(rom, analysis, HEADER_END), []);
  assert.deepEqual(
    refs.map((r) => [r.kind, r.site - BASE, r.target - BASE]),
    [
      ['bl', 0x102, 0x120],
      ['pool-load', 0x106, 0x10c],
      ['pool-load', 0x122, 0x12c],
      ['short-branch', 0x124, 0x128],
    ],
  );
});

test('labels: func, pool, local, data and chunk labels; global when referenced from another module or a uniquely named function', () => {
  const { rom, analysis, config } = scene();
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.labels.map((l) => [l.addr - BASE, l.name, l.kind, l.thumb, l.scope]),
    [
      [0, 'rom_header', 'data', false, 'module'],
      [0xc0, 'unk_080000C0', 'data', false, 'module'],
      [0x100, 'F', 'func', true, 'global'],
      [0x10c, '_0800010C', 'pool', false, 'module'],
      [0x110, 'unk_08000110', 'data', false, 'module'],
      [0x120, 'G', 'func', true, 'global'],
      [0x128, '_08000128', 'local', false, 'module'],
      [0x12c, '_0800012C', 'pool', false, 'module'],
      [0x130, 'gUnk_08000130', 'data', false, 'module'],
      [0x180, 'gUnk_08000180', 'data', false, 'global'],
    ],
  );
});

test('a pool word inside a named, sized entry names the entry: its label global, no gUnk_ label at the word (wordNameOf)', () => {
  // G's pool word 0x08000180 lies inside gTable [0x170, 0x190) of the data module: it prints `gTable + 16`, so gTable
  // is referenced from module b and no gUnk_08000180 is made for it.
  const { rom, analysis, config } = scene();
  const sized = { ...config, symbols: new Map([[BASE + 0x170, { name: 'gTable', size: 0x20, aliases: [] }]]) };
  const model = buildModel(rom, analysis, sized);
  assert.deepEqual(
    model.labels.filter((l) => l.addr >= BASE + 0x130).map((l) => [l.addr - BASE, l.name, l.kind, l.scope]),
    [
      [0x130, 'gUnk_08000130', 'data', 'module'],
      [0x170, 'gTable', 'data', 'global'],
    ],
  );
  const g = model.chunks.findIndex((c) => c.name === 'G');
  assert.ok(printChunk(rom, model, g, 'readable').lines.includes('_0800012C: .4byte gTable + 16'));
  const unsized = buildModel(rom, analysis, {
    ...config,
    symbols: new Map([[BASE + 0x170, { name: 'gTable', aliases: [] }]]),
  });
  assert.deepEqual(
    unsized.labels.filter((l) => l.addr >= BASE + 0x170).map((l) => [l.name, l.scope]),
    [
      ['gTable', 'module'],
      ['gUnk_08000180', 'global'],
    ],
    'without a size the word names its own label',
  );
});

test('a pool word never references a local label: a code address of another module stays module-scoped', () => {
  // F's pool word holds 0x08000128, G's branch target in module b, which only a local label names: printed as a value.
  const { rom, analysis, config } = scene(BASE + 0x128);
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(
    model.labels.filter((l) => l.addr === BASE + 0x128).map((l) => [l.name, l.kind, l.scope]),
    [['_08000128', 'local', 'module']],
  );
});

test('a pool word names a Thumb function only in its +1 form; the bare address references nothing', () => {
  const { rom, analysis, config } = scene(BASE + 0x120);
  const model = buildModel(rom, analysis, config);
  // Still global: the bl at 0x102 calls G from module a.
  assert.equal(model.labels.find((l) => l.name === 'G')?.scope, 'global');
  // G's name is defined in module a too (an alias of F), so G is global only when module a references it (D111).
  const repeated = {
    ...config,
    functions: new Map([...config.functions].map(([a, f]) => [a, a === BASE + 0x100 ? { ...f, aliases: ['G'] } : f])),
  };
  const noCall = buildModel(
    rom,
    {
      ...analysis,
      functions: analysis.functions.map((f) =>
        f.entry === BASE + 0x100 ? { ...f, code: [{ start: BASE + 0x106, end: BASE + 0x10c }] } : f,
      ),
    },
    repeated,
  );
  assert.equal(
    noCall.labels.find((l) => l.name === 'G')?.scope,
    'module',
    'the pool word holds G without the Thumb bit',
  );
  const viaPool = scene();
  const thumbForm = buildModel(
    viaPool.rom,
    {
      ...viaPool.analysis,
      functions: viaPool.analysis.functions.map((f) =>
        f.entry === BASE + 0x100 ? { ...f, code: [{ start: BASE + 0x106, end: BASE + 0x10c }] } : f,
      ),
    },
    viaPool.config,
  );
  assert.equal(thumbForm.labels.find((l) => l.name === 'G')?.scope, 'global', 'G | 1 in a pool word of module a');
});

test('a local label gives way to another label at its address; a table has a table label and local targets', () => {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    b _08000104
    pop {r0}
    bx r0
  `;
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: code },
      { at: BASE + 0x108, bytes: words(BASE + 0x105, BASE + 0x107) },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(rom, {
    functions: [
      fact({
        entry: BASE + 0x100,
        end: BASE + 0x110,
        code: [{ start: BASE + 0x100, end: BASE + 0x108 }],
        tables: [{ base: BASE + 0x108, targets: [BASE + 0x104, BASE + 0x106], thumbBit: true }],
      }),
    ],
  });
  const model = buildModel(
    rom,
    analysis,
    configOf({
      modules: [
        ['rom_header', BASE],
        ['main', HEADER_END],
      ],
      functions: [
        [BASE + 0x100, 'F'],
        [BASE + 0x104, { name: 'Inner', entryPoint: true }],
      ],
    }),
  );
  assert.deepEqual(
    model.labels.filter((l) => l.addr >= BASE + 0x100).map((l) => [l.addr - BASE, l.name, l.kind]),
    [
      [0x100, 'F', 'func'],
      [0x104, 'Inner', 'func'],
      [0x106, '_08000106', 'local'],
      [0x108, '_08000108', 'table'],
      [0x110, 'unk_08000110', 'data'],
    ],
  );
  assert.deepEqual(
    model.chunks.find((c) => c.name === 'F')?.innerLabels.map((l) => l.name),
    ['Inner'],
  );
});

test("no local label where no item can start: an adr naming a bl's second half or an odd address prints raw (D63)", () => {
  // F's adr names 0x10C, the second halfword of its bl; A's (ARM) adr names 0x141, G's entry plus the Thumb bit,
  // which the bx after it switches to (m4a's mixer does this). The printer could not place either label.
  const f = thumbAt(BASE + 0x100)`
    push {lr}
    adr r0, _0800010C
    movs r0, #0
    movs r0, #0
    movs r0, #0
    bl _08000140
    pop {r1}
    bx r1
  `;
  const a = armAt(BASE + 0x130)`
    adr r0, _08000141
    bx r0
  `;
  const g = thumbAt(BASE + 0x140)`
    bx lr
  `;
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: f },
      { at: BASE + 0x130, bytes: a },
      { at: BASE + 0x140, bytes: g },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: BASE + 0x100, end: BASE + 0x112 }),
      fact({ entry: BASE + 0x130, end: BASE + 0x138, mode: 'arm' }),
      fact({ entry: BASE + 0x140, end: BASE + 0x142 }),
    ],
  });
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['main', HEADER_END],
      { name: 'data', start: BASE + 0x144, kind: 'data', generated: true },
    ],
    functions: [
      [BASE + 0x100, 'F'],
      [BASE + 0x130, { name: 'A', mode: 'arm' }],
      [BASE + 0x140, 'G'],
    ],
  });
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(
    model.labels.filter((l) => l.addr === BASE + 0x10c || l.addr === BASE + 0x141),
    [],
  );
  const raw = rows(model.items)
    .filter(([kind]) => kind === ItemKind.rawInsn)
    .map(([, start]) => start - BASE);
  assert.deepEqual(raw, [0x102, 0x130]);
  for (let i = 0; i < model.items.count; i++) {
    if (model.items.kind[i] === ItemKind.rawInsn)
      assert.equal(ITEM_RAW_REASONS[model.items.aux[i] ?? -1], 'no-roundtrip');
  }
});

test('an adr of a Thumb function gets a local label it names (D72 c); an adr of an ARM function names the function', () => {
  // G (Thumb, 0x140) is called by F and named by an adr in F (Thumb) and in A (ARM); H (ARM, 0x148) by an adr in F.
  // G's symbol links to 0x141, so neither adr may name G; H's symbol links to its address.
  const f = thumbAt(BASE + 0x100)`
    push {lr}
    adr r0, _08000140
    adr r1, _08000148
    bl _08000140
    pop {r1}
    bx r1
  `;
  const a = armAt(BASE + 0x130)`
    adr r0, _08000140
    bx lr
  `;
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: f },
      { at: BASE + 0x130, bytes: a },
      { at: BASE + 0x140, bytes: thumbAt(BASE + 0x140)`bx lr` },
      { at: BASE + 0x148, bytes: armAt(BASE + 0x148)`bx lr` },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: BASE + 0x100, end: BASE + 0x10e }),
      fact({ entry: BASE + 0x130, end: BASE + 0x138, mode: 'arm' }),
      fact({ entry: BASE + 0x140, end: BASE + 0x142 }),
      fact({ entry: BASE + 0x148, end: BASE + 0x14c, mode: 'arm' }),
    ],
  });
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['main', HEADER_END],
      { name: 'data', start: BASE + 0x14c, kind: 'data', generated: true },
    ],
    functions: [
      [BASE + 0x100, 'F'],
      [BASE + 0x130, { name: 'A', mode: 'arm' }],
      [BASE + 0x140, 'G'],
      [BASE + 0x148, { name: 'H', mode: 'arm' }],
    ],
  });
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.labels
      .filter((l) => l.addr === BASE + 0x140 || l.addr === BASE + 0x148)
      .map((l) => [l.name, l.kind, l.thumb, l.scope]),
    [
      ['G', 'func', true, 'global'],
      ['_08000140', 'local', false, 'module'],
      ['H', 'func', false, 'global'],
    ],
  );
  const raw = rows(model.items).filter(([kind]) => kind === ItemKind.rawInsn);
  assert.deepEqual(raw, [], 'every adr prints as a mnemonic');
});
