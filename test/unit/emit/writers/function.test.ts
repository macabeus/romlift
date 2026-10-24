// The function writer (architecture §6.3): one file per function chunk at its chunkPaths path, the chunk as
// printChunk prints it, no preamble (the module's file includes it), ending with a newline; a chunk that folded
// the pad before its entry opens with its start macro, which emits the pad.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { printChunk } from '../../../../src/core/emit/print/chunk.ts';
import { functionWriter } from '../../../../src/core/emit/writers/function.ts';
import { buildModel } from '../../../../src/core/model/model.ts';
import { chunkPaths, chunkPathsOf } from '../../../../src/core/model/paths.ts';
import { codeItems, label, modelOf, romWith } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END } from '../../layout/hand-made.ts';
import { sampleModel, sampleRom } from '../print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: [] } };

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
  assert.deepEqual(chunkPathsOf(m), chunkPaths(m));
  assert.equal(chunkPathsOf(m), chunkPathsOf(m), 'computed once per model');
});

/** buildModel over A (0x100..0x10A), a 2-byte zero pad and B (0x10C), which folds the pad (phase-3.md Q5 b). */
function foldedPad() {
  const r = romWith(
    [
      { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; movs r0, #0; bl _0800010C; pop {pc}` },
      { at: BASE + 0x10c, bytes: thumbAt(BASE + 0x10c)`movs r0, #1; bx lr` },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(r, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10a }), fact({ entry: BASE + 0x10c, end: BASE + 0x110 })] });
  const config = configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x110, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'A'], [BASE + 0x10c, 'B']] });
  return { rom: r, model: buildModel(r, analysis, config) };
}

test('a function that folded the pad before it: its file opens with the start macro at the entry and holds no .align', () => {
  const { rom: r, model: m } = foldedPad();
  const main = m.modules.findIndex((x) => x.name === 'main');
  const entries = [...functionWriter.emit(r, m, cx, main)];
  assert.deepEqual(entries.map((e) => e.path), ['asm/nonmatchings/main/A.s', 'asm/nonmatchings/main/B.s']);
  const b = entries[1];
  assert.ok(b !== undefined && b.ownership === 'generated');
  assert.equal(b.text, '.thumb\n\tthumb_func_start_local B\nB: @ 0800010C\n\tmovs r0, #1\n\tbx lr\n\tthumb_func_end B\n');
});
