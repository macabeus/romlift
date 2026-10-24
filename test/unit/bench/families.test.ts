// The phase-2 per-ROM families a `bench run` records (architecture §8.4, §8.6): entries, extents and the
// code end always; determinism when the two digests agree; scaffold while the PoC dump gives a verdict;
// speed when bench/baseline/speed.json holds the ROM. Together they are the families live at phase 2. From
// phase 3 readability always, and scaffold from romlift's own raw link (--scaffold) instead of the dump.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES, liveFamilies, phase2RomFamilies, phase3RomFamilies } from '../../../bench/src/families.ts';

test('a ROM that measured everything records every family live at phase 2', () => {
  assert.deepEqual(phase2RomFamilies({ deterministic: true, speedBaseline: true, scaffold: true }), liveFamilies(2, 'rom'));
});

test('a family that did not run is left out', () => {
  assert.deepEqual(phase2RomFamilies({ deterministic: false, speedBaseline: false, scaffold: false }), ['code-end', 'entries', 'extents']);
  assert.deepEqual(phase2RomFamilies({ deterministic: true, speedBaseline: false, scaffold: true }), ['code-end', 'determinism', 'entries', 'extents', 'scaffold']);
  assert.deepEqual(phase2RomFamilies({ deterministic: false, speedBaseline: true, scaffold: false }), ['code-end', 'entries', 'extents', 'speed']);
});

test('phase 3: readability always, scaffold only from romlift raw link; a full run records every family live at phase 3', () => {
  assert.deepEqual(phase3RomFamilies({ deterministic: true, speedBaseline: true, scaffold: true }), liveFamilies(3, 'rom'));
  assert.deepEqual(phase3RomFamilies({ deterministic: false, speedBaseline: false, scaffold: false }), ['code-end', 'entries', 'extents', 'readability']);
  assert.deepEqual(phase3RomFamilies({ deterministic: true, speedBaseline: false, scaffold: true }), ['code-end', 'determinism', 'entries', 'extents', 'readability', 'scaffold']);
});

test('the families live at phase 3: readability per ROM, memory and the printer globally', () => {
  assert.deepEqual(liveFamilies(3, 'rom'), ['code-end', 'determinism', 'entries', 'extents', 'readability', 'scaffold', 'speed']);
  assert.deepEqual(liveFamilies(3, 'global'), ['memory', 'printer']);
  assert.deepEqual(liveFamilies(2, 'global'), ['printer']);
});

test('the readability summary leaves the objdiff score to g5.objdiff, phase 6\'s since D76 g (gate-honesty-r0-1, D68 a)', () => {
  assert.equal(FAMILIES.readability.summary, 'readability shares only increase (objdiff: g5.objdiff, phase 6 since D76 g)');
  assert.equal(FAMILIES.readability.liveFrom, 3);
  for (const [name, spec] of Object.entries(FAMILIES)) assert.doesNotMatch(spec.summary, /objdiff score 0/, name);
});
