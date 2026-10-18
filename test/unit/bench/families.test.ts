// The phase-2 per-ROM families a `bench run` records (architecture §8.4, §8.6): entries, extents and the
// code end always; determinism when the two digests agree; scaffold while the PoC dump gives a verdict;
// speed when bench/baseline/speed.json holds the ROM. Together they are the families live at phase 2.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liveFamilies, phase2RomFamilies } from '../../../bench/src/families.ts';

test('a ROM that measured everything records every family live at phase 2', () => {
  assert.deepEqual(phase2RomFamilies({ deterministic: true, speedBaseline: true, scaffold: true }), liveFamilies(2, 'rom'));
});

test('a family that did not run is left out', () => {
  assert.deepEqual(phase2RomFamilies({ deterministic: false, speedBaseline: false, scaffold: false }), ['code-end', 'entries', 'extents']);
  assert.deepEqual(phase2RomFamilies({ deterministic: true, speedBaseline: false, scaffold: true }), ['code-end', 'determinism', 'entries', 'extents', 'scaffold']);
  assert.deepEqual(phase2RomFamilies({ deterministic: false, speedBaseline: true, scaffold: false }), ['code-end', 'entries', 'extents', 'speed']);
});
