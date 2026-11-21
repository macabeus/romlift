// bench/src/objdiff-classes.ts: each detail shape of objdiff.ts's differences goes to its class (the rows of
// phase-3.md Q1); a same-word class is given only when the word each side links to is checked from the ELF's
// addresses, the addends and the base's plain value, a missing fact is `unverified` (gated), and the totals: what D34
// as amended gates (D102), the uncompared functions, the same-word differences and D34 before D102 (architecture-r1-1).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classCounts,
  classTotals,
  isGated,
  nameAddresses,
  objdiffClass,
} from '../../../../bench/src/objdiff-classes.ts';
import {
  type DifferenceFacts,
  type ObjdiffDifference,
  type ObjdiffKind,
  pcRelativeChunkRange,
} from '../../../../bench/src/objdiff.ts';
import { codeItems, dataItem, modelOf, poolItem, romWith, words } from '../../../helpers/model.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const names = nameAddresses([
  { name: 'gScreen', addr: 0x0300_0000 },
  { name: 'MainCB', addr: 0x0802_0f88, thumb: true },
  { name: 'MainCB', addr: 0x0803_0000, thumb: true },
  { name: 'gMenu', addr: 0x0200_0040 },
  { name: 'gChooseFileState', addr: 0x0200_0040 },
  { name: 'sTalkText', addr: 0x0300_00c8 },
  { name: 'gBg0Tm', addr: 0x0200_0000, size: 0x800 },
  { name: 'gBg1Tm', addr: 0x0200_0800, size: 0x800 },
  { name: 'StaticHelper', addr: 0x0805_aab0, thumb: true },
]);

const ABS32 = 2;
const THM_CALL = 10;

const ex = (kind: ObjdiffKind, detail: string, facts: DifferenceFacts = {}): ObjdiffDifference => ({
  kind,
  example: { function: 'f', kind, detail },
  facts,
});

test('every detail shape goes to its class when its facts check out', () => {
  const rows: readonly (readonly [ObjdiffDifference, string])[] = [
    [
      ex(
        'resolved-call',
        '+0x68 arg-mismatch: bl 0x7c | bl PutAnim-0x4 (PutAnim is at that offset of the reference object)',
      ),
      'resolved-call',
    ],
    // The reference's bl reaches its section's start plus 0x5f4, where the ELF (or the default spelling) puts the callee.
    [
      ex('instruction', '+0x8e0 arg-mismatch: bl 0x5f4 | bl sub_0805AAB0-0x4', { sectionBase: 0x0805_aab0 - 0x5f4 }),
      'static-callee',
    ],
    [
      ex('instruction', '+0x8e0 arg-mismatch: bl 0x5f4 | bl StaticHelper-0x4', { sectionBase: 0x0805_aab0 - 0x5f4 }),
      'static-callee',
    ],
    [
      ex('instruction', '+0x8e0 arg-mismatch: bl 0x5f4 | bl sub_0805AAB0-0x4', { sectionBase: 0x0805_aab0 - 0x5f0 }),
      'instruction-other',
    ],
    [ex('instruction', '+0x8e0 arg-mismatch: bl 0x5f4 | bl sub_0805AAB0-0x4'), 'unverified'],
    [
      ex('instruction', '+0x53e arg-mismatch: b 0x4e2 | b _080B9D1A-0x4', { sectionBase: 0x080b_9d1a - 0x4e2 }),
      'static-callee',
    ],
    [ex('instruction', '+0x54c arg-mismatch: .word 0x30000c8 | .word sTalkText'), 'value-named'],
    [ex('instruction', '+0x2024 arg-mismatch: .word 0x8820046 | .word gUnk_08820046'), 'value-named'],
    [ex('instruction', '+0x10 arg-mismatch: .word 0x8020f89 | .word MainCB'), 'value-named'],
    [ex('instruction', '+0x10 arg-mismatch: .word 0x8020f88 | .word MainCB'), 'instruction-other'],
    [ex('instruction', '+0x10 arg-mismatch: .word 0x8820048 | .word gUnk_08820046'), 'instruction-other'],
    // romlift's `name + offset` against the reference's constant: the same word when the name plus the addend links to it.
    [ex('instruction', '+0x484 arg-mismatch: .word 0x3000004 | .word gScreen+0x4'), 'value-named'],
    [ex('instruction', '+0x484 arg-mismatch: .word 0x2fffffc | .word gScreen-0x4'), 'value-named'],
    [ex('instruction', '+0x484 arg-mismatch: .word 0x3000008 | .word gScreen+0x4'), 'instruction-other'],
    [ex('instruction', '+0x10 arg-mismatch: .word 0x8020f8d | .word MainCB+0x4'), 'value-named'],
    [ex('instruction', '+0x10 arg-mismatch: .word 0x8020f8c | .word MainCB+0x3'), 'instruction-other'],
    [ex('instruction', '+0x9fe delete: .hword 0x0 | (none)'), 'trailing-pad'],
    [ex('instruction', '+0x232 replace: b 0x2a8 | .hword 0xe039'), 'instruction-other'],
    [
      ex('relocation', '+0x18 R_ARM_ABS32: gMenu | gChooseFileState', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseAddend: 0,
      }),
      'alias',
    ],
    [
      ex('relocation', '+0x18 R_ARM_ABS32: gMenu | gChooseFileState', {
        relocationType: ABS32,
        referenceAddend: 4,
        baseAddend: 0,
      }),
      'relocation-other',
    ],
    [
      ex('relocation', '+0x18 R_ARM_ABS32: gMenu | gChooseFileState', { relocationType: ABS32, referenceAddend: 0 }),
      'unverified',
    ],
    [
      ex('relocation', '+0x180 R_ARM_ABS32: MainCB | sub_08020F88', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseAddend: 0,
      }),
      'alias',
    ],
    [
      ex('relocation', '+0x180 R_ARM_THM_PC22: MainCB | sub_08020F88', {
        relocationType: THM_CALL,
        referenceAddend: -4,
        baseAddend: -4,
      }),
      'alias',
    ],
    [
      ex('relocation', '+0x1c0 R_ARM_ABS32: gUnk_080B2CD8 | RAMFUNCS_END', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseAddend: 0,
      }),
      'unverified',
    ],
    // gBg1Tm lies at gBg0Tm + 0x800, inside gBg0Tm's 0x800 bytes or at their end: the reference's gBg0Tm + 0x800 is the same word.
    [
      ex('relocation', '+0x1f64 R_ARM_ABS32: gBg0Tm | gBg1Tm', {
        relocationType: ABS32,
        referenceAddend: 0x800,
        baseAddend: 0,
      }),
      'symbol-addend',
    ],
    [
      ex('relocation', '+0x1f64 R_ARM_ABS32: gBg0Tm | gBg1Tm', {
        relocationType: ABS32,
        referenceAddend: 0x7fc,
        baseAddend: 0,
      }),
      'relocation-other',
    ],
    [ex('relocation', '+0x1f64 R_ARM_ABS32: gBg0Tm | gBg1Tm', { relocationType: ABS32, baseAddend: 0 }), 'unverified'],
    [
      ex('relocation', '+0x1f64 R_ARM_ABS32: gBg1Tm | gBg0Tm', {
        relocationType: ABS32,
        referenceAddend: -0x800,
        baseAddend: 0,
      }),
      'relocation-other',
    ],
    // romlift's default name of the address (D111) where the reference's symbol plus addend lands: the same word, as
    // the plain value it stands for; a default name of another word, or a real name outside the symbol, stays gated.
    [
      ex('relocation', '+0x10 R_ARM_ABS32: gScreen | gUnk_03000002', {
        relocationType: ABS32,
        referenceAddend: 2,
        baseAddend: 0,
      }),
      'default-name',
    ],
    [
      ex('relocation', '+0x1530 R_ARM_ABS32: gBg1Tm | gUnk_020007F8', {
        relocationType: ABS32,
        referenceAddend: -8,
        baseAddend: 0,
      }),
      'default-name',
    ],
    [
      ex('relocation', '+0x10 R_ARM_ABS32: gScreen | gUnk_03000004', {
        relocationType: ABS32,
        referenceAddend: 2,
        baseAddend: 0,
      }),
      'relocation-other',
    ],
    [
      ex('relocation', '+0x10 R_ARM_ABS32: gScreen | sTalkText', {
        relocationType: ABS32,
        referenceAddend: 0xc8,
        baseAddend: 0,
      }),
      'relocation-other',
    ],
    [
      ex('relocation', '+0x10 R_ARM_ABS32: gScreen | gUnk_03000002', {
        relocationType: 40,
        referenceAddend: 2,
        baseAddend: 0,
      }),
      'unverified',
    ],
    [
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0x10,
        baseField: 0x0300_0010,
      }),
      'value-for-symbol',
    ],
    [
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0x10,
        baseField: 0x0300_0014,
      }),
      'relocation-other',
    ],
    [
      ex('missing-relocation', '+0x9c R_ARM_ABS32: MainCB | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseField: 0x0802_0f89,
      }),
      'value-for-symbol',
    ],
    [
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0x10,
      }),
      'unverified',
    ],
    [
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gNowhere | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseField: 0,
      }),
      'unverified',
    ],
    // A bl at 0x08020000 (section start 0x08020000, offset 0): the reference's MainCB - 4 is the site plus the base's plain offset 0xF84.
    [
      ex('missing-relocation', '+0x0 R_ARM_THM_PC22: MainCB | a plain value', {
        relocationType: THM_CALL,
        referenceAddend: -4,
        baseField: 0xf84,
        sectionBase: 0x0802_0000,
        offset: 0,
      }),
      'value-for-symbol',
    ],
    [
      ex('missing-relocation', '+0x0 R_ARM_THM_PC22: MainCB | a plain value', {
        relocationType: THM_CALL,
        referenceAddend: -4,
        baseField: 0xf80,
        sectionBase: 0x0802_0000,
        offset: 0,
      }),
      'relocation-other',
    ],
    [
      ex('missing-relocation', '+0x0 R_ARM_THM_PC22: MainCB | a plain value', {
        relocationType: THM_CALL,
        referenceAddend: -4,
        baseField: 0xf84,
      }),
      'unverified',
    ],
    [ex('unnamed-target', '+0x28 R_ARM_ABS32: section .rodata | X'), 'unnamed-target'],
    [ex('missing-symbol', 'no reference object defines it'), 'missing-symbol'],
    [ex('tool', 'Invalid instruction size 1'), 'tool'],
    [ex('assemble', 'source.s:9: Error: invalid offset'), 'assemble'],
    [ex('score', 'objdiff scored it 99% with no differing row'), 'score'],
  ];
  for (const [d, want] of rows)
    assert.equal(objdiffClass(d, names), want, `${d.example.detail} ${JSON.stringify(d.facts)}`);
});

test('a kind the classifier does not know is an error, never a silent class', () => {
  const unknown = {
    kind: 'new-kind',
    example: { function: 'f', kind: 'new-kind', detail: '' },
    facts: {},
  } as unknown as ObjdiffDifference;
  assert.throws(() => objdiffClass(unknown, names), /no class for the kind new-kind/);
});

test('the totals: D34 as amended (D102) gates the classes that differ in a word, or are unverified, and are compared; before it, every class but unnamed-target', () => {
  const counts = classCounts(
    [
      ex('resolved-call', 'bl 0x7c | bl A-0x4 (A is at that offset of the reference object)'),
      ex('instruction', '+0x9fe delete: .hword 0x0 | (none)'),
      ex('instruction', '+0x232 replace: b 0x2a8 | .hword 0xe039'),
      ex('missing-relocation', '+0x9c R_ARM_ABS32: gScreen | a plain value', {
        relocationType: ABS32,
        referenceAddend: 0,
        baseField: 0x0300_0000,
      }),
      ex('missing-relocation', '+0xa0 R_ARM_ABS32: gScreen | a plain value'),
      ex('missing-symbol', 'no reference object defines it'),
      ex('unnamed-target', '+0x28 R_ARM_ABS32: section .rodata | X'),
    ],
    names,
  );
  assert.equal(counts['trailing-pad'], 1);
  assert.equal(counts['value-for-symbol'], 1);
  assert.equal(counts['unverified'], 1);
  assert.equal(counts['static-callee'], 0);
  assert.deepEqual(classTotals(counts), { gated: 3, uncompared: 1, sameWord: 2, beforeAmendment: 6 });
  assert.deepEqual(
    (
      [
        'resolved-call',
        'value-named',
        'value-for-symbol',
        'default-name',
        'missing-symbol',
        'tool',
        'unnamed-target',
        'unverified',
        'trailing-pad',
        'relocation-other',
        'instruction-other',
        'assemble',
        'score',
      ] as const
    ).filter(isGated),
    ['unverified', 'trailing-pad', 'relocation-other', 'instruction-other', 'assemble', 'score'],
  );
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
      { at: 0x0800_011c, bytes: words(2) },
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
