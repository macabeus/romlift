// Jump-table entries (architecture §5): `.4byte _0800ABCD`, `+ 1` when the stored value carries the Thumb
// bit, the addend computed against what the label links to, numeric when the target has no visible label.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { wordScope } from '../../../../src/core/emit/print/pool.ts';
import { tableEntryLine, tableEntryOperand } from '../../../../src/core/emit/print/table.ts';
import { dataItem, label, modelOf, romWith } from '../../../helpers/model.ts';

const A = 0x0800_1000;
const rom = romWith([], { size: 0x2000 });
const model = modelOf(rom, {
  modules: [{ name: 'alpha', chunks: [{ name: 'Alpha', items: [dataItem(A, 0x1000)] }] }],
  labels: [label('_0800ABCD', A + 0x10, { kind: 'local' }), label('Case', A + 0x20), label('ArmCase', A + 0x30, { thumb: false })],
});

test('a local target prints its label, + 1 with the Thumb bit', () => {
  assert.equal(tableEntryLine(wordScope(model, 'alpha'), A + 0x10, false), '\t.4byte _0800ABCD');
  assert.equal(tableEntryLine(wordScope(model, 'alpha'), A + 0x10, true), '\t.4byte _0800ABCD + 1');
});

test('a Thumb function target already links with the Thumb bit', () => {
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x20, true), 'Case');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x20, false), 'Case - 1');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x30, true), 'ArmCase + 1');
});

test('a target without a visible label prints the stored value', () => {
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x40, true), '0x08001041');
  assert.equal(tableEntryOperand(wordScope(model, 'alpha'), A + 0x40, false), '0x08001040');
});
