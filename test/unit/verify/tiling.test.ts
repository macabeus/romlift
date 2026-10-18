// The tiling self-check and verifyModel (architecture §6.2, §6.4): a consistent model passes all three model
// checks; each level's first gap or overlap is E_SELF_CHECK_TILING at its address.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Model } from '../../../src/core/model/types.ts';
import { checkTiling, verifyModel } from '../../../src/core/verify/tiling.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';
import { fixtureModel, fixtureRom } from './fixture.ts';

const rom = fixtureRom();
const model = fixtureModel(rom);

function codes(m: Model): readonly (string | number | undefined)[][] {
  return checkTiling(rom, m).diagnostics.map((d) => [d.code, d.addr]);
}

test('a consistent model passes tiling, re-encode and module size', () => {
  const report = verifyModel(rom, model);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.ok]),
    [
      ['tiling', true],
      ['reencode', true],
      ['module-size', true],
    ],
  );
  assert.equal(report.ok, true);
  assert.match(report.checks[0]?.detail ?? '', /15 items, 7 chunks and 4 modules tile 0x08000000\.\.0x08000400/);
});

test('an item gap is named at its first byte', () => {
  const r = romWith([], { size: 0x400 });
  const m = modelOf(r, {
    modules: [{ name: 'all', kind: 'data', chunks: [{ kind: 'data', name: 'a', items: [dataItem(0x0800_0000, 0x100), dataItem(0x0800_0104, 0x2fc)] }] }],
  });
  const result = checkTiling(r, m);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0]?.code, 'E_SELF_CHECK_TILING');
  assert.equal(result.diagnostics[0]?.addr, 0x0800_0100);
  assert.match(result.diagnostics[0]?.message ?? '', /gap 0x08000100\.\.0x08000104/);
});

test('an overlap of two items is named where the second starts', () => {
  const r = romWith([], { size: 0x400 });
  const m = modelOf(r, {
    modules: [{ name: 'all', kind: 'data', chunks: [{ kind: 'data', name: 'a', items: [dataItem(0x0800_0000, 0x104), dataItem(0x0800_0100, 0x300)] }] }],
  });
  const d = checkTiling(r, m).diagnostics[0];
  assert.equal(d?.code, 'E_SELF_CHECK_TILING');
  assert.equal(d?.addr, 0x0800_0100);
  assert.match(d?.message ?? '', /overlaps/);
});

test('items that stop short of the ROM end, or run past it, fail', () => {
  const r = romWith([], { size: 0x400 });
  const short = modelOf(r, { modules: [{ name: 'all', kind: 'data', chunks: [{ kind: 'data', name: 'a', items: [dataItem(0x0800_0000, 0x3fc)] }] }] });
  assert.match(checkTiling(r, short).diagnostics[0]?.message ?? '', /gap 0x080003FC\.\.0x08000400 at the end of the ROM/);
  const long = modelOf(r, { modules: [{ name: 'all', kind: 'data', chunks: [{ kind: 'data', name: 'a', items: [dataItem(0x0800_0000, 0x404)] }] }] });
  assert.match(checkTiling(r, long).diagnostics[0]?.message ?? '', /past the ROM end/);
});

test('a chunk that does not span its items fails at the chunk level only', () => {
  const chunks = model.chunks.map((c, i) => (i === 2 ? { ...c, span: { start: c.span.start, end: c.span.end + 2 } } : c));
  const found = codes({ ...model, chunks });
  assert.deepEqual(found[0], ['E_SELF_CHECK_TILING', 0x0800_0100]);
  assert.match(checkTiling(rom, { ...model, chunks }).diagnostics[0]?.message ?? '', /chunk Func .* does not span its items/);
});

test('a chunk naming another module, and modules that leave a gap, fail at the module level', () => {
  const chunks = model.chunks.map((c, i) => (i === 3 ? { ...c, module: 'data' } : c));
  assert.match(checkTiling(rom, { ...model, chunks }).diagnostics[0]?.message ?? '', /chunk Veneer lies in module main .* but names module data/);
  const modules = model.modules.map((m, i) => (i === 3 ? { ...m, span: { start: m.span.start + 4, end: m.span.end } } : m));
  const d = checkTiling(rom, { ...model, modules }).diagnostics;
  assert.equal(d.length, 1);
  assert.match(d[0]?.message ?? '', /module data .* does not span its chunks/);
});

test('a model of another ROM size fails', () => {
  assert.match(checkTiling(rom, { ...model, rom: { ...model.rom, end: 0x0800_0800 } }).diagnostics[0]?.message ?? '', /ROM ending at 0x08000800/);
});
