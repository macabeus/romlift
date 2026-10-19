// Fault injection into the re-encode self-check (g3.checks-fail, architecture §6.4, §10, D14): an insn
// item whose row cannot round-trip (an undefined Thumb encoding recorded as a mnemonic) fails with
// E_SELF_CHECK_REENCODE at its address, and the report is not ok.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { specIndex } from '../../../src/core/model/item-table.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { verifyModel } from '../../../src/core/verify/tiling.ts';
import { fixtureModel, fixtureRom } from '../../unit/verify/fixture.ts';

test('an instruction item that cannot round-trip fails the re-encode check with E_SELF_CHECK_REENCODE', () => {
  const clean = fixtureRom();
  const model = fixtureModel(clean);
  assert.equal(verifyModel(clean, model).ok, true, 'the unmutated model passes');
  const bytes = clean.bytes.slice();
  bytes.set([0x00, 0xb1], 0x10c); // Veneer's `bx pc` becomes 0xB100, an undefined Thumb encoding
  const rom = romFromBytes(bytes, 'mutated');
  const veneer = Array.from(model.items.start).indexOf(0x0800_010c);
  const spec = model.items.spec.slice();
  spec[veneer] = specIndex('thumb.undefined');
  const report = verifyModel(rom, { ...model, items: { ...model.items, spec } });
  assert.equal(report.ok, false);
  const reencode = report.checks.find((c) => c.id === 'reencode');
  assert.equal(reencode?.ok, false);
  assert.equal(reencode?.diagnostics.length, 1);
  assert.equal(reencode?.diagnostics[0]?.code, 'E_SELF_CHECK_REENCODE');
  assert.equal(reencode?.diagnostics[0]?.addr, 0x0800_010c);
  assert.match(reencode?.diagnostics[0]?.message ?? '', /thumb\.undefined prints raw \(undefined\)/);
  assert.equal(report.checks.find((c) => c.id === 'tiling')?.ok, true, 'only the re-encode check fails');
});
