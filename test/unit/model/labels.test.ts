// The model's labels (architecture §5, §6.2 step 4): func labels with the config's names, pool labels at pool
// words, table labels, local labels at targets no other label names, gUnk_ data labels where a pool word points
// into a data module, chunk labels; scope 'global' only when another module references the label (a call, a
// pool word in its Thumb form, ...).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildModel } from '../../../src/core/model/model.ts';
import { codeRefs } from '../../../src/core/model/labels.ts';
import { segmentsOf } from '../../../src/core/model/items.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith, thumbAt, words } from '../layout/hand-made.ts';

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
      fact({ entry: BASE + 0x100, end: BASE + 0x110, code: [{ start: BASE + 0x100, end: BASE + 0x10c }], pools: [BASE + 0x10c] }),
      fact({ entry: BASE + 0x120, end: BASE + 0x130, code: [{ start: BASE + 0x120, end: BASE + 0x12c }], pools: [BASE + 0x12c] }),
    ],
  });
  const config = configOf({
    modules: [['rom_header', BASE], ['a', HEADER_END], ['b', BASE + 0x120], { name: 'data', start: BASE + 0x130, kind: 'data', generated: true }],
    functions: [[BASE + 0x100, 'F'], [BASE + 0x120, 'G']],
  });
  return { rom, analysis, config };
}

test('codeRefs: every branch, bl and pool load of the code, at its site', () => {
  const { rom, analysis } = scene();
  const refs = codeRefs(rom, segmentsOf(rom, analysis, HEADER_END), []);
  assert.deepEqual(refs.map((r) => [r.kind, r.site - BASE, r.target - BASE]), [
    ['bl', 0x102, 0x120],
    ['pool-load', 0x106, 0x10c],
    ['pool-load', 0x122, 0x12c],
    ['short-branch', 0x124, 0x128],
  ]);
});

test('labels: func, pool, local, data and chunk labels; global only when referenced from another module', () => {
  const { rom, analysis, config } = scene();
  const model = buildModel(rom, analysis, config);
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(
    model.labels.map((l) => [l.addr - BASE, l.name, l.kind, l.thumb, l.scope]),
    [
      [0, 'rom_header', 'data', false, 'module'],
      [0xc0, 'unk_080000C0', 'data', false, 'module'],
      [0x100, 'F', 'func', true, 'module'],
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

test('a pool word names a Thumb function only in its +1 form; the bare address references nothing', () => {
  const { rom, analysis, config } = scene(BASE + 0x120);
  const model = buildModel(rom, analysis, config);
  // Still global: the bl at 0x102 calls G from module a.
  assert.equal(model.labels.find((l) => l.name === 'G')?.scope, 'global');
  const noCall = buildModel(rom, { ...analysis, functions: analysis.functions.map((f) => (f.entry === BASE + 0x100 ? { ...f, code: [{ start: BASE + 0x106, end: BASE + 0x10c }] } : f)) }, config);
  assert.equal(noCall.labels.find((l) => l.name === 'G')?.scope, 'module', 'the pool word holds G without the Thumb bit');
  const viaPool = scene();
  const thumbForm = buildModel(viaPool.rom, { ...viaPool.analysis, functions: viaPool.analysis.functions.map((f) => (f.entry === BASE + 0x100 ? { ...f, code: [{ start: BASE + 0x106, end: BASE + 0x10c }] } : f)) }, viaPool.config);
  assert.equal(thumbForm.labels.find((l) => l.name === 'G')?.scope, 'global', 'G | 1 in a pool word of module a');
});

test('a local label gives way to another label at its address; a table has a table label and local targets', () => {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    b _08000104
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }, { at: BASE + 0x108, bytes: words(BASE + 0x105, BASE + 0x107) }], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110, code: [{ start: BASE + 0x100, end: BASE + 0x108 }], tables: [{ base: BASE + 0x108, targets: [BASE + 0x104, BASE + 0x106], thumbBit: true }] })],
  });
  const model = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'F'], [BASE + 0x104, { name: 'Inner', label: true }]] }));
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
  assert.deepEqual(model.chunks.find((c) => c.name === 'F')?.innerLabels.map((l) => l.name), ['Inner']);
});
