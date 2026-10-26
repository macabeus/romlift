// Jump-table entries (architecture §5): `.4byte _0800ABCD`, `+ 1` when the stored value carries the Thumb
// bit, the label and addend from R_ARM_ABS32's one rule (resolver.ts addendTo): a Thumb function names an odd entry
// and never an even one, which names a local label at the target or prints its stored value.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wordScope } from '../../../../src/core/emit/print/pool.ts';
import { tableEntryLine, tableEntryOperand } from '../../../../src/core/emit/print/table.ts';
import { dataItem, label, modelOf, romWith } from '../../../helpers/model.ts';

const A = 0x0800_1000;
const rom = romWith([], { size: 0x2000 });
const model = modelOf(rom, {
  modules: [{ name: 'alpha', chunks: [{ name: 'Alpha', items: [dataItem(A, 0x1000)] }] }],
  labels: [
    label('_0800ABCD', A + 0x10, { kind: 'local' }),
    label('Case', A + 0x20),
    label('ArmCase', A + 0x30, { thumb: false }),
    label('Both', A + 0x50),
    label('_08001050', A + 0x50, { kind: 'local' }),
  ],
});

test('a local target prints its label, + 1 with the Thumb bit', () => {
  assert.equal(tableEntryLine(wordScope(model, 'alpha'), A + 0x10, false), '\t.4byte _0800ABCD');
  assert.equal(tableEntryLine(wordScope(model, 'alpha'), A + 0x10, true), '\t.4byte _0800ABCD + 1');
});

test('a Thumb function target already links with the Thumb bit, so it names only an odd entry', () => {
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x20, true), 'Case');
  // `Case - 1` would link to (S - 1) | 1, 0x0800101F (binutils 2.45.1), never S.
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x20, false), '0x08001020');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x30, true), 'ArmCase + 1');
});

test('an even entry at a Thumb function names the local label beside it, an odd one the function', () => {
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x50, false), '_08001050');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x50, true), 'Both');
});

test('a target without a visible label prints the stored value', () => {
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x40, true), '0x08001041');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x40, false), '0x08001040');
});
