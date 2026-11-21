// Fault injection into the module-size self-check (g3.checks-fail, architecture §6.4, §10): a module whose
// span runs four bytes past its items fails with E_MODULE_SIZE naming it, and the report is not ok.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyModel } from '../../../src/core/verify/tiling.ts';
import { fixtureModel, fixtureRom } from '../../unit/verify/fixture.ts';

test('a module whose items miss its span fails the module-size check with E_MODULE_SIZE', () => {
  const rom = fixtureRom();
  const model = fixtureModel(rom);
  assert.equal(verifyModel(rom, model).ok, true, 'the unmutated model passes');
  const modules = model.modules.map((m) =>
    m.name === 'main' ? { ...m, span: { start: m.span.start, end: m.span.end + 4 } } : m,
  );
  const report = verifyModel(rom, { ...model, modules });
  assert.equal(report.ok, false);
  const size = report.checks.find((c) => c.id === 'module-size');
  assert.equal(size?.ok, false);
  assert.deepEqual(
    size?.diagnostics.map((d) => [d.code, d.severity, d.addr]),
    [['E_MODULE_SIZE', 'error', 0x0800_0100]],
  );
  assert.match(size?.detail ?? '', /module main spans 68 bytes .* but its items add up to 64/);
});
