// The re-encode self-check (architecture §5, §6.4, D14): every insn item passes the printing rule under its
// module's resolver; raw-insn items are not checked; a wrong recorded row and a raw encoding fail.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { specIndex } from '../../../src/core/model/item-table.ts';
import { checkReencode } from '../../../src/core/verify/reencode.ts';
import { codeItems, label, modelOf, romWith } from '../../helpers/model.ts';
import { thumbAt } from '../../helpers/thumb.ts';
import { fixtureModel, fixtureRom } from './fixture.ts';

test('every instruction of the fixture re-encodes', () => {
  const rom = fixtureRom();
  const result = checkReencode(rom, fixtureModel(rom));
  assert.equal(result.ok, true);
  assert.equal(result.detail, '7 instructions re-encode');
});

test('a branch re-encodes to a label of its own module, and a pool load without its label prints raw', () => {
  const rom = romWith([{ at: 0x0800_0000, bytes: thumbAt(0x0800_0000)`b _08000004; mov r8, r8; bx lr; mov r8, r8` }], {
    size: 0x400,
  });
  const items = codeItems(rom, 0x0800_0000, 0x0800_0008, 'thumb');
  const spec = (labels: Parameters<typeof modelOf>[1]['labels']) =>
    modelOf(rom, {
      modules: [
        { name: 'm', chunks: [{ name: 'f', items: [...items, { kind: 'data', start: 0x0800_0008, length: 0x3f8 }] }] },
      ],
      labels: labels ?? [],
    });
  assert.equal(
    checkReencode(rom, spec([label('f', 0x0800_0000), label('_08000004', 0x0800_0004, { kind: 'local' })])).ok,
    true,
  );
  assert.equal(checkReencode(rom, spec([label('f', 0x0800_0000)])).ok, false, 'a branch to no label prints raw');
  const raw = romWith([{ at: 0x0800_0000, bytes: Uint8Array.from([0x00, 0x48, 0x70, 0x47]) }], { size: 0x400 });
  const loads = modelOf(raw, {
    modules: [
      {
        name: 'm',
        chunks: [
          {
            name: 'f',
            items: [
              ...codeItems(raw, 0x0800_0000, 0x0800_0004, 'thumb'),
              { kind: 'data', start: 0x0800_0004, length: 0x3fc },
            ],
          },
        ],
      },
    ],
  });
  const result = checkReencode(raw, loads);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, 'E_SELF_CHECK_REENCODE');
  assert.equal(result.diagnostics[0]?.addr, 0x0800_0000);
  assert.match(result.diagnostics[0]?.message ?? '', /thumb\.ldr_literal prints raw \(no-roundtrip\)/);
});

test('a raw-insn item is not checked; an insn item whose row is not its bytes fails', () => {
  const rom = romWith([{ at: 0x0800_0000, bytes: Uint8Array.from([0x00, 0xb1, 0x70, 0x47]) }], { size: 0x400 });
  const rest = { kind: 'data' as const, start: 0x0800_0004, length: 0x3fc };
  const raw = modelOf(rom, {
    modules: [
      {
        name: 'm',
        chunks: [
          {
            name: 'f',
            items: [
              { kind: 'raw-insn', start: 0x0800_0000, length: 2, specId: 'thumb.undefined', reason: 'undefined' },
              ...codeItems(rom, 0x0800_0002, 0x0800_0004, 'thumb'),
              rest,
            ],
          },
        ],
      },
    ],
  });
  assert.equal(checkReencode(rom, raw).ok, true);
  const wrong = modelOf(rom, {
    modules: [
      {
        name: 'm',
        chunks: [
          {
            name: 'f',
            items: [
              { kind: 'insn', start: 0x0800_0000, length: 2, specId: 'thumb.bx' },
              ...codeItems(rom, 0x0800_0002, 0x0800_0004, 'thumb'),
              rest,
            ],
          },
        ],
      },
    ],
  });
  const d = checkReencode(rom, wrong).diagnostics;
  assert.equal(d.length, 1);
  assert.match(d[0]?.message ?? '', /records thumb\.bx \(2 bytes\) but its bytes decode as thumb\.undefined/);
  assert.notEqual(specIndex('thumb.bx'), undefined);
});

test('the instructions of a runs_at chunk decode at their run address', () => {
  // bl from 0x03000000 to 0x03000100: its offset only re-encodes when decoded at the run address.
  const bytes = thumbAt(0x0300_0000)`bl _03000100; bx lr`;
  const rom = romWith([{ at: 0x0800_0100, bytes }], { size: 0x400 });
  const code = codeItems(rom, 0x0800_0100, 0x0800_0106, 'thumb');
  const m = modelOf(rom, {
    modules: [
      {
        name: 'head',
        kind: 'data',
        chunks: [{ kind: 'data', name: 'head', items: [{ kind: 'data', start: 0x0800_0000, length: 0x100 }] }],
      },
      {
        name: 'ram',
        runAt: 0x0300_0000,
        chunks: [
          {
            name: 'RamFunc',
            runAt: 0x0300_0000,
            items: [...code, { kind: 'data', start: 0x0800_0106, length: 0x2fa }],
          },
        ],
      },
    ],
    labels: [label('RamFunc', 0x0300_0000), label('Target', 0x0300_0100)],
  });
  assert.equal(checkReencode(rom, m).ok, true);
  const atLoad = { ...m, chunks: m.chunks.map(({ runAt: _, ...c }) => c) };
  assert.equal(checkReencode(rom, atLoad).ok, false, 'decoded at its load address, the bl targets no label');
});
