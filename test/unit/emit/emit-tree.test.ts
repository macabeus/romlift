// emitTree (architecture §3.4, §6.3, §9.4, D17, D62): per generated module in ROM order its module-scoped
// writers' entries sorted by path, then the global writers' entries sorted by path; a module whose
// `generated` is false yields nothing; lazy (consuming the first entries does not print later modules);
// re-callable and deterministic.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emitTree, emitWith } from '../../../src/core/emit/emit-tree.ts';
import type { FileEntry, Writer } from '../../../src/core/emit/tree.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { codeItems, dataItem, label, modelOf, romWith } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { sampleModel, sampleRom } from './print/fixture.ts';

const rom = sampleRom();
const model = sampleModel(rom);
const cx = { decomp: { defined: new Set<string>() } };
const MINE = new Set(['header', 'crt0', 'function', 'orphan', 'module']);
const mine = (entries: Iterable<FileEntry>): FileEntry[] => [...entries].filter((e) => e.ownership === 'generated' && MINE.has(e.writer));

const EXPECTED = [
  'asm/rom_header.s',
  'asm/crt0.s',
  'asm/nonmatchings/crt0/unk_080000D0.s',
  'asm/main.s',
  'asm/nonmatchings/main/Helper.s',
  'asm/nonmatchings/main/Main.s',
  'asm/nonmatchings/main/Switch.s',
  'asm/nonmatchings/main/Tail.s',
  'asm/nonmatchings/main/ThumbToArm.s',
  'asm/nonmatchings/main/ThumbToArmPadded.s',
  'asm/nonmatchings/main/unk_08000160.s',
  'asm/nonmatchings/other/ArmFunc.s',
  'asm/nonmatchings/other/Helper.s',
  'asm/other.s',
];

test('the code writers\' files come module by module in ROM order, each module sorted by path', () => {
  assert.deepEqual(mine(emitTree(rom, model, cx)).map((e) => e.path), EXPECTED);
});

test('module-scoped writers per module, then global writers, each group sorted by path', () => {
  const fake = (id: 'ldscript' | 'symbols', path: string): Writer => ({ id, scope: 'global', emit: (_r, _m, _c, module) => (module === null ? [{ ownership: 'generated', path, text: '\n', writer: id }] : []) });
  const perModule: Writer = { id: 'data', scope: 'module', emit: (_r, m, _c, module) => (module === null ? [] : [{ ownership: 'generated', path: `z/${m.modules[module]?.name ?? ''}`, text: '\n', writer: 'data' }, { ownership: 'generated', path: `a/${m.modules[module]?.name ?? ''}`, text: '\n', writer: 'data' }]) };
  const paths = [...emitWith(rom, model, cx, [fake('symbols', 'symbols.ld'), perModule, fake('ldscript', 'ldscript.txt')])].map((e) => e.path);
  assert.deepEqual(paths, ['a/rom_header', 'z/rom_header', 'a/crt0', 'z/crt0', 'a/main', 'z/main', 'a/other', 'z/other', 'ldscript.txt', 'symbols.ld']);
});

test('a module whose generated is false yields nothing', () => {
  const r = romWith([]);
  const m = modelOf(r, {
    modules: [
      { name: 'kept', chunks: [{ kind: 'orphan', name: 'unk_08000200', items: [dataItem(0x0800_0200, 4)] }] },
      { name: 'retained', generated: false, chunks: [{ kind: 'orphan', name: 'unk_08000204', items: [dataItem(0x0800_0204, 4)] }] },
    ],
  });
  assert.deepEqual(mine(emitTree(r, m, cx)).map((e) => e.path), ['asm/kept.s', 'asm/nonmatchings/kept/unk_08000200.s']);
});

test('the stream is lazy: the first module\'s entries come without printing a later module', () => {
  const at = 0x0800_0200;
  const r = romWith([{ at, bytes: thumbAt(at)`bx lr` }]);
  const m: Model = modelOf(r, {
    modules: [
      { name: 'good', chunks: [{ name: 'Good', items: [...codeItems(r, at, at + 2, 'thumb'), { kind: 'padding', start: at + 2, length: 2 }] }] },
      // the bytes at at + 4 are zeros, not the branch this item records: printing it throws
      { name: 'broken', chunks: [{ name: 'Broken', items: [{ kind: 'insn', start: at + 4, length: 2, specId: 'thumb.b' }] }] },
    ],
    labels: [label('Good', at), label('Broken', at + 4)],
  });
  const it = emitTree(r, m, cx)[Symbol.iterator]();
  assert.equal(it.next().value?.path, 'asm/good.s');
  assert.equal(it.next().value?.path, 'asm/nonmatchings/good/Good.s');
  assert.throws(() => [...emitTree(r, m, cx)], /decodes as/);
});

test('re-callable and deterministic: two runs and two iterations of one stream yield equal entries', () => {
  const stream = emitTree(rom, model, cx);
  const first = [...stream];
  assert.deepEqual([...stream], first);
  assert.deepEqual([...emitTree(rom, model, cx)], first);
  assert.deepEqual([...emitTree(rom, sampleModel(sampleRom()), cx)], first);
});

test('every generated text ends with a newline and names no absolute path', () => {
  for (const printer of ['readable', 'raw'] as const) {
    for (const e of mine(emitTree(rom, model, { ...cx, printer }))) {
      assert.ok(e.ownership === 'generated');
      assert.ok(e.text.endsWith('\n'), e.path);
      assert.ok(!e.text.endsWith('\n\n'), e.path);
      assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\/.test(e.text), e.path);
    }
  }
});

test('the raw printer writes the same paths', () => {
  assert.deepEqual(mine(emitTree(rom, model, { ...cx, printer: 'raw' })).map((e) => e.path), EXPECTED);
});
