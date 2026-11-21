// The module writer (architecture §6.3): asm/<module>.s for an asm module other than the header's and the
// startup region's: the preamble, then `.include` of each chunk file in ROM order. With the function and
// orphan files it reproduces the module's bytes, with both printers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { functionWriter } from '../../../../src/core/emit/writers/function.ts';
import { moduleWriter } from '../../../../src/core/emit/writers/module.ts';
import { orphanWriter } from '../../../../src/core/emit/writers/orphan.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { dataItem, modelOf, romWith } from '../../../helpers/model.ts';
import { layoutUnit, romBytes, sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: [] } };

test('asm/<module>.s: the preamble and one include per chunk file, in ROM order', () => {
  const entries = [...moduleWriter.emit(rom, model, cx, 2)];
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.ok(entry.ownership === 'generated');
  assert.equal(entry.path, 'asm/main.s');
  assert.equal(entry.writer, 'module');
  assert.equal(
    entry.text,
    `${DIALECT.preamble('thumb')}${['Main', 'Helper', 'Switch', 'ThumbToArm', 'ThumbToArmPadded', 'Tail', 'unk_08000160'].map((n) => `.include "asm/nonmatchings/main/${n}.s"\n`).join('')}`,
  );
  const other = [...moduleWriter.emit(rom, model, cx, 3)][0]!;
  assert.ok(other.ownership === 'generated' && other.text.startsWith(DIALECT.preamble('arm')));
});

test('the header and startup modules, a data module and no module yield nothing', () => {
  for (const i of [0, 1]) assert.deepEqual([...moduleWriter.emit(rom, model, cx, i)], []);
  assert.deepEqual([...moduleWriter.emit(rom, model, cx, null)], []);
  const r = romWith([]);
  const m = modelOf(r, {
    modules: [
      {
        name: 'data',
        kind: 'data',
        chunks: [{ kind: 'data', name: 'data_start', items: [dataItem(0x0800_0200, 0x10)] }],
      },
    ],
  });
  assert.deepEqual([...moduleWriter.emit(r, m, cx, 0)], []);
});

test('a library module names its library under the preamble', () => {
  const r = romWith([]);
  const m = modelOf(r, {
    modules: [
      {
        name: 'm4a',
        library: { name: 'm4a', version: '2001' },
        chunks: [{ kind: 'orphan', name: 'unk_08000200', items: [dataItem(0x0800_0200, 4)] }],
      },
    ],
  });
  const entry = [...moduleWriter.emit(r, m, cx, 0)][0]!;
  assert.ok(entry.ownership === 'generated');
  assert.equal(entry.text, `${DIALECT.preamble('thumb')}@ m4a 2001\n.include "asm/nonmatchings/m4a/unk_08000200.s"\n`);
});

test('every module file with its includes reproduces the module bytes, with both printers', () => {
  for (const printer of ['readable', 'raw'] as const) {
    for (const [i, name] of [
      [2, 'main'],
      [3, 'other'],
    ] as const) {
      const c = { ...cx, printer };
      const entries = [
        ...moduleWriter.emit(rom, model, c, i),
        ...functionWriter.emit(rom, model, c, i),
        ...orphanWriter.emit(rom, model, c, i),
      ];
      const { layout, errors } = layoutUnit(model, entries, `asm/${name}.s`, name);
      assert.deepEqual(errors, [], `${printer} ${name}`);
      const span = model.modules[i]!.span;
      assert.deepEqual(layout.bytes, romBytes(rom, span.start, span.end), `${printer} ${name}`);
    }
  }
});
