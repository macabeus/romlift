// The pool naming rule (architecture §5 "Literal pools"): a word prints as a name only when `.4byte Name`
// links to that word: an odd value equal to a Thumb function + 1 is named, an even one equal to a Thumb
// function stays numeric, an ARM function, a table, a pool or a data label is named, a local label never, RAM
// and unlabelled values are numeric, and a label of another module is a candidate only when global.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { poolLine, poolLoadComment, visibleLabelsAt, wordScope, wordText } from '../../../../src/core/emit/print/pool.ts';
import { dataItem, label, modelOf, romWith } from '../../../helpers/model.ts';

const A = 0x0800_1000;
const B = 0x0800_2000;
const rom = romWith([], { size: 0x3000 });
const model = modelOf(rom, {
  modules: [
    { name: 'alpha', chunks: [{ name: 'Alpha', items: [dataItem(A, 0x1000)] }] },
    { name: 'beta', chunks: [{ name: 'Beta', items: [dataItem(B, 0x1000)] }] },
  ],
  labels: [
    label('ThumbFn', A + 0x10),
    label('ArmFn', A + 0x20, { thumb: false }),
    label('_08001030', A + 0x30, { kind: 'pool', thumb: false }),
    label('_08001040', A + 0x40, { kind: 'table', thumb: false }),
    label('gData', A + 0x51, { kind: 'data', thumb: false }),
    label('_08001060', A + 0x60, { kind: 'local' }),
    label('BetaStatic', B + 0x10),
    label('BetaGlobal', B + 0x20, { scope: 'global' }),
    label('_08002020', B + 0x20, { kind: 'local', scope: 'global' }),
  ],
});

test('an odd word equal to a Thumb function + 1 names it; the even word stays numeric', () => {
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x11), 'ThumbFn');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x10), '0x08001010');
});

test('ARM functions, pools, tables and data labels name their exact address; a local label never names a word', () => {
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x20), 'ArmFn');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x21), '0x08001021', 'an ARM function + 1 is not what .4byte ArmFn links to');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x30), '_08001030');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x40), '_08001040');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x51), 'gData', 'an odd data address names its label');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x60), '0x08001060');
});

test('RAM, I/O and unlabelled ROM words are numeric', () => {
  assert.equal(wordText(wordScope(model, 'alpha'), 0x0300_0000), '0x03000000');
  assert.equal(wordText(wordScope(model, 'alpha'), 0x0400_0001), '0x04000001');
  assert.equal(wordText(wordScope(model, 'alpha'), A + 0x71), '0x08001071');
  assert.equal(wordText(wordScope(model, 'alpha'), 0), '0x00000000');
});

test('a module-scoped label of another module is not a candidate; a global one is, preferred by kind', () => {
  assert.equal(wordText(wordScope(model, 'alpha'), B + 0x11), '0x08002011');
  assert.equal(wordText(wordScope(model, 'beta'), B + 0x11), 'BetaStatic');
  assert.equal(wordText(wordScope(model, 'alpha'), B + 0x21), 'BetaGlobal');
  assert.deepEqual(visibleLabelsAt(wordScope(model, 'alpha'), B + 0x20).map((l) => l.name), ['BetaGlobal', '_08002020']);
  assert.deepEqual(visibleLabelsAt(wordScope(model, 'alpha'), B + 0x10), []);
});

test('a pool line carries its labels on the same line; a load comment names the word', () => {
  assert.equal(poolLine(['_08001A3C'], 'gFoo'), '_08001A3C: .4byte gFoo');
  assert.equal(poolLine(['a', 'b'], '0x00000001'), 'a: b: .4byte 0x00000001');
  assert.equal(poolLine([], 'gFoo'), '\t.4byte gFoo');
  assert.equal(poolLoadComment('gFoo'), '@ =gFoo');
});

const C = 0x0800_3000;
const sizedRom = romWith([], { size: 0x4000 });
const sizedModel = modelOf(sizedRom, {
  modules: [
    { name: 'alpha', chunks: [{ name: 'Alpha', items: [dataItem(A, 0x1000)] }] },
    { name: 'gamma', chunks: [{ name: 'Gamma', items: [dataItem(C, 0x1000)] }] },
  ],
  labels: [
    label('gTable', A + 0x100, { kind: 'data', thumb: false }),
    label('gUnk_08001108', A + 0x108, { kind: 'data', thumb: false }),
    label('gNamedInside', A + 0x10c, { kind: 'data', thumb: false }),
    label('gRam', 0x0300_0000, { kind: 'data', thumb: false, scope: 'global' }),
    label('SizedFn', A + 0x200),
    label('gHidden', C + 0x10, { kind: 'data', thumb: false }),
  ],
  symbols: [
    { addr: A + 0x100, name: 'gTable', size: 0x20 },
    { addr: A + 0x10c, name: 'gNamedInside' },
    { addr: 0x0300_0000, name: 'gRam', size: 0x40 },
    { addr: C + 0x10, name: 'gHidden', size: 0x10 },
  ],
  functions: [
    { entry: A + 0x200, extent: { start: A + 0x200, end: A + 0x220 }, mode: 'thumb', name: 'SizedFn', aliases: [], source: { name: { kind: 'toml' }, extent: 'toml-size' } },
  ],
});

test('a word inside a named, sized entry prints name + offset; a named entry exactly at the word keeps its name', () => {
  const alpha = wordScope(sizedModel, 'alpha');
  assert.equal(wordText(alpha, A + 0x104), 'gTable + 4');
  assert.equal(wordText(alpha, A + 0x108), 'gTable + 8', 'an unnamed label inside the entry gives way to it');
  assert.equal(wordText(alpha, A + 0x10c), 'gNamedInside', 'a [symbols] entry at the word is named itself');
  assert.equal(wordText(alpha, A + 0x100), 'gTable');
  assert.equal(wordText(alpha, A + 0x120), '0x08001120', 'the end of the entry is not inside it');
  assert.equal(wordText(alpha, 0x0300_0010), 'gRam + 16', 'a RAM symbol symbols.ld defines');
  assert.equal(wordText(alpha, A + 0x205), 'SizedFn + 4', 'inside a function sized by the TOML: from the word SizedFn links to');
  assert.equal(wordText(alpha, A + 0x201), 'SizedFn');
  assert.equal(wordText(alpha, C + 0x14), '0x08003014', 'a module-scoped entry of another module is not visible');
  assert.equal(wordText(wordScope(sizedModel, 'gamma'), C + 0x14), 'gHidden + 4');
});
