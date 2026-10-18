// The function writer (architecture §6.3): one file per function chunk at its chunkPaths path, the chunk as
// printChunk prints it, no preamble (the module's file includes it), ending with a newline.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printChunk } from '../../../../src/core/emit/print/chunk.ts';
import { chunkFilePaths } from '../../../../src/core/emit/unit-text.ts';
import { functionWriter } from '../../../../src/core/emit/writers/function.ts';
import { chunkPaths } from '../../../../src/core/model/paths.ts';
import { codeItems, label, modelOf, romWith } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: new Set<string>() } };

test('one file per function chunk of the module, in ROM order, with the chunk text and a final newline', () => {
  const entries = [...functionWriter.emit(rom, model, cx, 2)];
  assert.deepEqual(
    entries.map((e) => e.path),
    ['Main', 'Helper', 'Switch', 'ThumbToArm', 'ThumbToArmPadded', 'Tail'].map((n) => `asm/nonmatchings/main/${n}.s`),
  );
  const main = entries[0]!;
  assert.ok(main.ownership === 'generated');
  assert.equal(main.writer, 'function');
  assert.equal(main.text, `${printChunk(rom, model, 3).lines.join('\n')}\n`);
  assert.ok(main.text.startsWith('.thumb\n\tthumb_func_start Main\n'));
});

test('a name repeated in another module is that module\'s own file; the raw printer writes the same paths', () => {
  const other = [...functionWriter.emit(rom, model, cx, 3)];
  assert.deepEqual(other.map((e) => e.path), ['asm/nonmatchings/other/ArmFunc.s', 'asm/nonmatchings/other/Helper.s']);
  assert.deepEqual([...functionWriter.emit(rom, model, { ...cx, printer: 'raw' }, 3)].map((e) => e.path), other.map((e) => e.path));
  assert.deepEqual([...functionWriter.emit(rom, model, cx, 0)], []);
  assert.deepEqual([...functionWriter.emit(rom, model, cx, null)], []);
});

test('names that differ only by case get the address suffix, from paths.ts', () => {
  const at = 0x0800_0200;
  const r = romWith([{ at, bytes: thumbAt(at)`bx lr; bx lr` }]);
  const m = modelOf(r, {
    modules: [{ name: 'main', chunks: [{ name: 'VBlankCB', items: codeItems(r, at, at + 2, 'thumb') }, { name: 'VblankCB', items: codeItems(r, at + 2, at + 4, 'thumb') }] }],
    labels: [label('VBlankCB', at), label('VblankCB', at + 2)],
  });
  assert.deepEqual([...functionWriter.emit(r, m, cx, 0)].map((e) => e.path), ['asm/nonmatchings/main/VBlankCB_08000200.s', 'asm/nonmatchings/main/VblankCB_08000202.s']);
  assert.deepEqual(chunkFilePaths(m), chunkPaths(m));
  assert.equal(chunkFilePaths(m), chunkFilePaths(m), 'computed once per model');
});
