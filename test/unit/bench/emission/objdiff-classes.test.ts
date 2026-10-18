// bench/src/objdiff-classes.ts: each detail shape of objdiff.ts's differences goes to its class (the rows of
// phase-3.md Q1), names resolve through the ELF's symbols and then romlift's default spellings, and the totals
// D34 gates and option (b) would gate.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classCounts, gatedTotals, nameAddresses, objdiffClass } from '../../../../bench/src/objdiff-classes.ts';
import { pcRelativeChunkRange } from '../../../../bench/src/objdiff.ts';
import { codeItems, dataItem, modelOf, poolItem, romWith, words } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const names = nameAddresses([
  { name: 'gScreen', addr: 0x0300_0000 },
  { name: 'MainCB', addr: 0x0802_0f88 },
  { name: 'MainCB', addr: 0x0803_0000 },
  { name: 'gMenu', addr: 0x0200_0040 },
  { name: 'gChooseFileState', addr: 0x0200_0040 },
  { name: 'sTalkText', addr: 0x0300_00c8 },
  { name: 'gBg0Tm', addr: 0x0200_0000, size: 0x800 },
  { name: 'gBg1Tm', addr: 0x0200_0800, size: 0x800 },
]);

const ex = (kind: string, detail: string): { function: string; kind: string; detail: string } => ({ function: 'f', kind, detail });

test('every detail shape goes to its class', () => {
  const rows: readonly (readonly [string, string, string])[] = [
    ['resolved-call', '+0x68 arg-mismatch: bl 0x7c | bl PutAnim-0x4 (PutAnim is at that offset of the reference object)', 'resolved-call'],
    ['instruction', '+0x8e0 arg-mismatch: bl 0x5f4 | bl sub_0805AAB0-0x4', 'static-callee'],
    ['instruction', '+0x53e arg-mismatch: b 0x4e2 | b _080B9D1A-0x4', 'static-callee'],
    ['instruction', '+0x54c arg-mismatch: .word 0x30000c8 | .word sTalkText', 'value-named'],
    ['instruction', '+0x2024 arg-mismatch: .word 0x8820046 | .word gUnk_08820046', 'value-named'],
    ['instruction', '+0x10 arg-mismatch: .word 0x8820048 | .word gUnk_08820046', 'instruction-other'],
    ['instruction', '+0x9fe delete: .hword 0x0 | (none)', 'trailing-pad'],
    ['instruction', '+0x232 replace: b 0x2a8 | .hword 0xe039', 'instruction-other'],
    ['relocation', '+0x18 R_ARM_ABS32: gMenu | gChooseFileState', 'alias'],
    ['relocation', '+0x180 R_ARM_ABS32: MainCB | sub_08020F88', 'alias'],
    ['relocation', '+0x1c0 R_ARM_ABS32: gUnk_080B2CD8 | RAMFUNCS_END', 'relocation-other'],
    ['relocation', '+0x1f64 R_ARM_ABS32: gBg0Tm | gBg1Tm', 'symbol-addend'],
    ['relocation', '+0x1f64 R_ARM_ABS32: gBg1Tm | gBg0Tm', 'relocation-other'],
    ['relocation', '+0x10 R_ARM_ABS32: gScreen | gUnk_03000002', 'relocation-other'],
    ['missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value', 'value-for-symbol'],
    ['unnamed-target', '+0x28 R_ARM_ABS32: section .rodata | X', 'unnamed-target'],
    ['missing-symbol', 'no reference object defines it', 'missing-symbol'],
    ['tool', 'Invalid instruction size 1', 'tool'],
    ['assemble', 'source.s:9: Error: invalid offset', 'assemble'],
    ['score', 'objdiff scored it 99% with no differing row', 'score'],
  ];
  for (const [kind, detail, want] of rows) assert.equal(objdiffClass(ex(kind, detail), names), want, detail);
});

test('the totals: D34 gates every class but unnamed-target; option (b) leaves the classes that differ in a word and are compared', () => {
  const counts = classCounts(
    [
      ex('resolved-call', 'bl 0x7c | bl A-0x4 (A is at that offset of the reference object)'),
      ex('instruction', '+0x9fe delete: .hword 0x0 | (none)'),
      ex('instruction', '+0x232 replace: b 0x2a8 | .hword 0xe039'),
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value'),
      ex('missing-symbol', 'no reference object defines it'),
      ex('unnamed-target', '+0x28 R_ARM_ABS32: section .rodata | X'),
    ],
    names,
  );
  assert.equal(counts['trailing-pad'], 1);
  assert.equal(counts['static-callee'], 0);
  assert.deepEqual(gatedTotals(counts), { gated: 5, gatedUnderOptionB: 2 });
});

test("pcRelativeChunkRange: a function's base takes every chunk of its module up to the far pools it and they reach", () => {
  // A (0x100) loads the pool word at 0x110, inside C; C loads the one at 0x11C, inside D; B lies between; E follows.
  const rom = romWith(
    [
      { at: 0x0800_0100, bytes: thumbAt(0x0800_0100)`ldr r0, _08000110; bx lr` },
      { at: 0x0800_0104, bytes: thumbAt(0x0800_0104)`bx lr; bx lr; bx lr; bx lr; bx lr; bx lr` },
      { at: 0x0800_0110, bytes: words(1) },
      { at: 0x0800_0114, bytes: thumbAt(0x0800_0114)`ldr r1, _0800011C; bx lr` },
      { at: 0x0800_0118, bytes: thumbAt(0x0800_0118)`bx lr; bx lr` },
      { at: 0x0800_011C, bytes: words(2) },
      { at: 0x0800_0120, bytes: thumbAt(0x0800_0120)`bx lr; bx lr` },
    ],
    { size: 0x200 },
  );
  const model = modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0x100)] }] },
      {
        name: 'main',
        chunks: [
          { name: 'A', items: codeItems(rom, 0x0800_0100, 0x0800_0104, 'thumb') },
          { name: 'B', items: codeItems(rom, 0x0800_0104, 0x0800_0110, 'thumb') },
          { name: 'C', items: [poolItem(rom, 0x0800_0110), ...codeItems(rom, 0x0800_0114, 0x0800_0118, 'thumb')] },
          { name: 'D', items: [...codeItems(rom, 0x0800_0118, 0x0800_011c, 'thumb'), poolItem(rom, 0x0800_011c)] },
          { name: 'E', items: [...codeItems(rom, 0x0800_0120, 0x0800_0124, 'thumb'), dataItem(0x0800_0124, 0xdc)] },
        ],
      },
    ],
  });
  const index = (name: string): number => model.chunks.findIndex((c) => c.name === name);
  assert.deepEqual(pcRelativeChunkRange(rom, model, index('A')), { first: index('A'), last: index('D') });
  assert.deepEqual(pcRelativeChunkRange(rom, model, index('B')), { first: index('B'), last: index('B') });
  assert.deepEqual(pcRelativeChunkRange(rom, model, index('E')), { first: index('E'), last: index('E') });
});
