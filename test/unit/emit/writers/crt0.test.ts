// The crt0 writer (architecture §6.3): asm/crt0.s, the startup region in one file: the preamble, a comment
// naming the region, the startup chunk inlined and a chunk with a file of its own included.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { crt0Writer } from '../../../../src/core/emit/writers/crt0.ts';
import { orphanWriter } from '../../../../src/core/emit/writers/orphan.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { layoutUnit, romBytes, sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: [] } };

test('the startup module yields asm/crt0.s with its chunks in ROM order', () => {
  const entries = [...crt0Writer.emit(rom, model, cx, 1)];
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.ok(entry.ownership === 'generated');
  assert.equal(entry.path, 'asm/crt0.s');
  assert.equal(entry.writer, 'crt0');
  assert.equal(
    entry.text,
    `${DIALECT.preamble('arm')}${[
      '@ startup region 080000C0..08000100',
      '',
      '.arm',
      '\tarm_func_start_local Start',
      'Start: @ 080000C0',
      '\tldr r0, _080000CC @ =Main',
      '\tmov lr, pc',
      '\tbx r0',
      '_080000CC: .4byte Main',
      '\tarm_func_end Start',
      '.include "asm/nonmatchings/crt0/unk_080000D0.s"',
    ].join('\n')}\n`,
  );
});

test('crt0.s and its include reproduce the startup region with both printers', () => {
  for (const printer of ['readable', 'raw'] as const) {
    const entries = [...crt0Writer.emit(rom, model, { ...cx, printer }, 1), ...orphanWriter.emit(rom, model, { ...cx, printer }, 1)];
    const { layout, errors } = layoutUnit(model, entries, 'asm/crt0.s', 'crt0');
    assert.deepEqual(errors, [], printer);
    assert.deepEqual(layout.bytes, romBytes(rom, 0x0800_00c0, 0x0800_0100), printer);
  }
});

test('any other module yields nothing', () => {
  for (const i of [0, 2, 3]) assert.deepEqual([...crt0Writer.emit(rom, model, cx, i)], []);
  assert.deepEqual([...crt0Writer.emit(rom, model, cx, null)], []);
});
