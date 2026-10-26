// The `data` writer (architecture §6.3): data/<module>.s on hand-made models: labels and [symbols] entries
// split the `.incbin` slices, table entries print `.4byte Name` (a Thumb function with its bit) or the
// number, padding prints `.align 2, 0`; the text-layout check reads every file back to its ROM range.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dataWriter } from '../../../../src/core/emit/writers/data.ts';
import type { FileEntry } from '../../../../src/core/emit/tree.ts';
import type { Model } from '../../../../src/core/model/types.ts';
import { entryDiagnostics } from '../../../helpers/text-layout.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { codeItems, dataItem, label, modelOf, romWith, words } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const CX = { decomp: { defined: [] } };

function emitted(rom: Rom, model: Model, module: number | null): readonly FileEntry[] {
  return [...dataWriter.emit(rom, model, CX, module)];
}

function textOf(entries: readonly FileEntry[]): string {
  const [e] = entries;
  assert.equal(entries.length, 1);
  assert.ok(e !== undefined && e.ownership === 'generated');
  return e.text;
}

const rom = romWith(
  [
    { at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`bx lr; mov r8, r8` },
    { at: 0x0800_0104, bytes: words(0x0800_0101, 0x0800_0200, 0x0800_0300, 0x0200_0000, 0x0800_0120) },
    { at: 0x0800_0118, bytes: Uint8Array.from({ length: 0x11 }, (_, i) => i + 1) },
    { at: 0x0800_012c, bytes: Uint8Array.from({ length: 0x2d4 }, (_, i) => (i * 13 + 5) & 0xff) },
  ],
  { size: 0x400 },
);

const model = modelOf(rom, {
  modules: [
    { name: 'head', kind: 'data', chunks: [{ kind: 'data', name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] },
    { name: 'code', chunks: [{ name: 'Func', items: codeItems(rom, 0x0800_0100, 0x0800_0104, 'thumb') }] },
    {
      name: 'tables',
      kind: 'data',
      chunks: [
        {
          kind: 'data',
          name: 'gTable',
          items: [
            { kind: 'table-entry', start: 0x0800_0104, target: 0x0800_0100, thumbBit: true },
            { kind: 'table-entry', start: 0x0800_0108, target: 0x0800_0200, thumbBit: false },
            { kind: 'table-entry', start: 0x0800_010c, target: 0x0800_0300, thumbBit: false },
            { kind: 'table-entry', start: 0x0800_0110, target: 0x0200_0000, thumbBit: false },
            { kind: 'table-entry', start: 0x0800_0114, target: 0x0800_0120, thumbBit: false },
            dataItem(0x0800_0118, 0x11),
            { kind: 'padding', start: 0x0800_0129, length: 3 },
            dataItem(0x0800_012c, 0x2d4),
          ],
        },
      ],
    },
  ],
  labels: [
    label('Func', 0x0800_0100, { scope: 'global' }),
    label('sStatic', 0x0800_0102, { kind: 'local', thumb: false }),
    label('gMid', 0x0800_0116, { kind: 'data', thumb: false, scope: 'global' }),
    label('gTarget', 0x0800_0200, { kind: 'data', thumb: false }),
    label('sStatic', 0x0800_0300, { kind: 'data', thumb: false }),
  ],
  symbols: [
    { addr: 0x0200_0000, name: 'gRam' },
    { addr: 0x0800_0180, name: 'gSym', size: 4 },
  ],
});

test('a data module: labels and symbols split the slices, table entries name their targets, padding aligns', () => {
  assert.deepEqual(emitted(rom, model, 1), [], 'an asm module has no data file');
  assert.deepEqual(emitted(rom, model, null), []);
  const [e] = emitted(rom, model, 2);
  assert.equal(e?.path, 'data/tables.s');
  assert.equal(e?.ownership, 'generated');
  assert.equal(e?.ownership === 'generated' ? e.writer : undefined, 'data');
  assert.equal(
    textOf(emitted(rom, model, 2)),
    `.syntax unified
.include "include/macros.inc"
.thumb

@ data module tables: 0x08000104..0x08000400, 764 bytes

\t.global gTable
gTable: @ 0x08000104
\t.4byte Func
\t.4byte gTarget
\t.4byte sStatic
\t.4byte gRam
\t.incbin "baserom.gba", 0x114, 0x2

\t.global gMid
gMid: @ 0x08000116
\t.incbin "baserom.gba", 0x116, 0x13
\t.align 2, 0
\t.incbin "baserom.gba", 0x12C, 0x54

\t.global gSym
gSym: @ 0x08000180
\t.incbin "baserom.gba", 0x180, 0x80

\t.global gTarget
gTarget: @ 0x08000200
\t.incbin "baserom.gba", 0x200, 0x100

sStatic: @ 0x08000300
\t.incbin "baserom.gba", 0x300, 0x100
`,
  );
});

test('the data file lays out to its module range under the text-layout check', () => {
  for (const module of [0, 2]) {
    const [e] = emitted(rom, model, module);
    assert.ok(e !== undefined);
    assert.deepEqual(entryDiagnostics(rom, model, e), [], e.path);
  }
});

test('a Thumb function label inside a data module is marked `.thumb_func`, so `.4byte` of it carries the bit', () => {
  const r = romWith([{ at: 0x0800_0100, bytes: words(0x0800_0111, 0x0800_0121) }], { size: 0x400 });
  const entries = [
    { kind: 'table-entry' as const, start: 0x0800_0100, target: 0x0800_0110, thumbBit: true },
    { kind: 'table-entry' as const, start: 0x0800_0104, target: 0x0800_0120, thumbBit: true },
  ];
  const m = modelOf(r, {
    modules: [{ name: 'all', kind: 'data', chunks: [{ kind: 'data', name: 'all', items: [dataItem(0x0800_0000, 0x100), ...entries, dataItem(0x0800_0108, 0x2f8)] }] }],
    labels: [label('Stray', 0x0800_0110), label('gWord', 0x0800_0120, { kind: 'data', thumb: false })],
  });
  const text = textOf(emitted(r, m, 0));
  assert.match(text, /\t\.4byte Stray\n/);
  // gWord is no function: the word with the Thumb bit prints as the number.
  assert.match(text, /\t\.4byte 0x08000121\n/);
  assert.match(text, /\t\.global Stray\n\t\.thumb_func\nStray: @ 0x08000110\n/);
  const [e] = emitted(r, m, 0);
  assert.ok(e !== undefined);
  assert.deepEqual(entryDiagnostics(r, m, e), []);
});

test('a runs_at data module: labels at their run addresses, slices at their load offsets', () => {
  const r = romWith([{ at: 0x0800_0100, bytes: words(0x0300_0004, 0x1234_5678) }], { size: 0x400 });
  const m = modelOf(r, {
    modules: [
      { name: 'head', kind: 'data', chunks: [{ kind: 'data', name: 'head', items: [dataItem(0x0800_0000, 0x100)] }] },
      {
        name: 'ram',
        kind: 'data',
        runAt: 0x0300_0000,
        chunks: [{ kind: 'data', name: 'gRamTable', runAt: 0x0300_0000, items: [{ kind: 'table-entry', start: 0x0800_0100, target: 0x0300_0004, thumbBit: false }, dataItem(0x0800_0104, 0x2fc)] }],
      },
    ],
    labels: [label('gRamWord', 0x0300_0004, { kind: 'data', thumb: false, scope: 'global' })],
  });
  const text = textOf(emitted(r, m, 1));
  assert.match(text, /gRamTable: @ 0x03000000\n\t\.4byte gRamWord\n\n\t\.global gRamWord\ngRamWord: @ 0x03000004\n\t\.incbin "baserom\.gba", 0x104, 0x2FC\n$/);
  const [e] = emitted(r, m, 1);
  assert.ok(e !== undefined);
  assert.deepEqual(entryDiagnostics(r, m, e), []);
});
