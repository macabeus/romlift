// Fault injection into the tiling self-check (g3.checks-fail, architecture §6.4, §10): an item moved down
// two bytes so it overlaps the padding before it fails with E_SELF_CHECK_TILING at the overlap, and the
// report is not ok (exit 3 once the CLI maps it).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyModel } from '../../../src/core/verify/tiling.ts';
import { fixtureModel, fixtureRom } from '../../unit/verify/fixture.ts';

test('an overlap of two items fails the tiling check with E_SELF_CHECK_TILING', () => {
  const rom = fixtureRom();
  const model = fixtureModel(rom);
  assert.equal(verifyModel(rom, model).ok, true, 'the unmutated model passes');
  const pool = Array.from(model.items.start).indexOf(0x0800_0108);
  const start = model.items.start.slice();
  start[pool] = 0x0800_0106;
  const report = verifyModel(rom, { ...model, items: { ...model.items, start } });
  assert.equal(report.ok, false);
  const tiling = report.checks.find((c) => c.id === 'tiling');
  assert.equal(tiling?.ok, false);
  assert.equal(tiling?.diagnostics[0]?.code, 'E_SELF_CHECK_TILING');
  assert.equal(tiling?.diagnostics[0]?.severity, 'error');
  assert.equal(tiling?.diagnostics[0]?.addr, 0x0800_0106);
  assert.match(tiling?.detail ?? '', /overlaps/);
});
