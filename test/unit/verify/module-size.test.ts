// The module-size self-check (architecture §6.4): each module's items add up to its span; every module that
// misses is named.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkModuleSize } from '../../../src/core/verify/module-size.ts';
import { fixtureModel, fixtureRom } from './fixture.ts';

const model = fixtureModel(fixtureRom());

test('the fixture modules add up to their spans', () => {
  const result = checkModuleSize(model);
  assert.equal(result.ok, true);
  assert.equal(result.detail, 'the items of each of 4 modules add up to its span');
});

test('every module that misses its span is named with its size and its items’ sum', () => {
  const modules = model.modules.map((m, i) => (i === 1 || i === 2 ? { ...m, span: { start: m.span.start, end: m.span.end + 4 } } : m));
  const result = checkModuleSize({ ...model, modules });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map((d) => [d.code, d.addr]),
    [
      ['E_MODULE_SIZE', 0x0800_00c0],
      ['E_MODULE_SIZE', 0x0800_0100],
    ],
  );
  assert.match(result.diagnostics[0]?.message ?? '', /module crt0 spans 68 bytes .* but its items add up to 64/);
  assert.match(result.detail, /and 1 more modules/);
});

test('a chunk dropped from a module leaves its items out of the sum', () => {
  const modules = model.modules.map((m, i) => (i === 2 ? { ...m, chunks: { first: m.chunks.first, count: m.chunks.count - 1 } } : m));
  const d = checkModuleSize({ ...model, modules }).diagnostics;
  assert.equal(d.length, 1);
  assert.match(d[0]?.message ?? '', /module main spans 64 bytes .* add up to 20/);
});
