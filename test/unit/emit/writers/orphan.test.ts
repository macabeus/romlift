// The orphan writer (architecture §6.2, §6.3): one file per orphan chunk, `@ bytes between functions`, a
// global unk_ label and its bytes, never glued to a neighbour.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orphanWriter } from '../../../../src/core/emit/writers/orphan.ts';
import { sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: new Set<string>() } };

test('one file per orphan chunk with the comment, the global label and the bytes', () => {
  const entries = [...orphanWriter.emit(rom, model, cx, 2)];
  assert.equal(entries.length, 1);
  const entry = entries[0]!;
  assert.ok(entry.ownership === 'generated');
  assert.equal(entry.path, 'asm/nonmatchings/main/unk_08000160.s');
  assert.equal(entry.writer, 'orphan');
  assert.ok(entry.text.startsWith('.thumb\n@ bytes between functions: 32 bytes\n.global unk_08000160\nunk_08000160: @ 08000160\n'), entry.text);
  assert.ok(entry.text.endsWith('\n'));
});

test('an orphan of the startup module has its file too; function chunks are not the orphan writer\'s', () => {
  assert.deepEqual([...orphanWriter.emit(rom, model, cx, 1)].map((e) => e.path), ['asm/nonmatchings/crt0/unk_080000D0.s']);
  assert.deepEqual([...orphanWriter.emit(rom, model, cx, 3)], []);
  assert.deepEqual([...orphanWriter.emit(rom, model, cx, null)], []);
});

test('the raw printer keeps the opening and prints the bytes as the PoC', () => {
  const entry = [...orphanWriter.emit(rom, model, { ...cx, printer: 'raw' }, 2)][0]!;
  assert.ok(entry.ownership === 'generated');
  assert.equal(
    entry.text,
    [
      '.thumb',
      '@ bytes between functions: 32 bytes',
      '.global unk_08000160',
      'unk_08000160: @ 08000160',
      '.global gTable',
      '\t.2byte 0x1110, 0x1312, 0x1514, 0x1716, 0x1918, 0x1B1A, 0x1D1C, 0x1F1E',
      'gTable: @ 08000170',
      '\t.2byte 0x2120, 0x2322, 0x2524, 0x2726, 0x2928, 0x2B2A, 0x2D2C, 0x2F2E',
      '',
    ].join('\n'),
  );
});
