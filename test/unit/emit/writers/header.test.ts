// The header writer (architecture §6.3): asm/rom_header.s for the module holding the header chunk, the
// dialect preamble then the PoC's `.byte` lines under a global label; nothing for any other module.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { headerWriter } from '../../../../src/core/emit/writers/header.ts';
import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { layoutUnit, romBytes, sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: [] } };

test('the header module yields asm/rom_header.s: the preamble, a global label and 16 bytes per .byte line', () => {
  const entries = [...headerWriter.emit(rom, model, cx, 0)];
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.equal(entry.ownership, 'generated');
  assert.equal(entry.path, 'asm/rom_header.s');
  assert.ok(entry.ownership === 'generated' && entry.writer === 'header');
  const text = entry.ownership === 'generated' ? entry.text : '';
  assert.ok(
    text.startsWith(
      `${DIALECT.preamble('thumb')}.thumb\n@ GBA cartridge header\n.global rom_header\nrom_header:\n\t.byte 0x00, `,
    ),
    text,
  );
  assert.ok(text.endsWith('0xED, 0x00, 0x00\n'));
  assert.equal(text.split('\n').filter((l) => l.startsWith('\t.byte')).length, 12);
  const { layout, errors } = layoutUnit(model, entries, 'asm/rom_header.s', 'rom_header');
  assert.deepEqual(errors, []);
  assert.deepEqual(layout.bytes, romBytes(rom, 0x0800_0000, 0x0800_00c0));
});

test('the raw printer writes the same header', () => {
  assert.deepEqual(
    [...headerWriter.emit(rom, model, { ...cx, printer: 'raw' }, 0)],
    [...headerWriter.emit(rom, model, cx, 0)],
  );
});

test('any other module yields nothing', () => {
  for (const i of [1, 2, 3]) assert.deepEqual([...headerWriter.emit(rom, model, cx, i)], []);
  assert.deepEqual([...headerWriter.emit(rom, model, cx, null)], []);
});
