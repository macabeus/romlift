// The phase-2 per-ROM families a `bench run` records (architecture §8.4, §8.6): entries, extents and the
// code end always; determinism when the two digests agree; scaffold while the PoC dump gives a verdict;
// speed when bench/baseline/speed.json holds the ROM. Together they are the families live at phase 2. From
// phase 3 readability always, and scaffold from romlift's own raw link (--scaffold) instead of the dump. From phase 6
// signatures when the locally built signature files were judged on the run.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES, liveFamilies, phase2RomFamilies, phase3RomFamilies, phase6RomFamilies } from '../../../bench/src/families.ts';

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

test('phase 6: signatures when the built files were judged; a full run records every family live at phase 6', () => {
  assert.deepEqual(phase6RomFamilies({ deterministic: true, speedBaseline: true, scaffold: true, signatures: true }), liveFamilies(6, 'rom'));
  assert.deepEqual(liveFamilies(6, 'rom'), [...liveFamilies(4, 'rom'), 'signatures'].sort());
  assert.deepEqual(phase6RomFamilies({ deterministic: true, speedBaseline: true, scaffold: true, signatures: false }), liveFamilies(4, 'rom'));
  assert.deepEqual(phase6RomFamilies({ deterministic: false, speedBaseline: false, scaffold: false, signatures: true }), ['code-end', 'entries', 'extents', 'readability', 'signatures']);
  assert.equal(FAMILIES.signatures.liveFrom, 6);
  assert.equal(FAMILIES.signatures.scope, 'rom');
  assert.match(FAMILIES.signatures.summary, /g6\.signatures-judged/);
});

test('the families live at phase 3: readability per ROM, memory and the printer globally', () => {
  assert.deepEqual(liveFamilies(3, 'rom'), ['code-end', 'determinism', 'entries', 'extents', 'readability', 'scaffold', 'speed']);
  assert.deepEqual(liveFamilies(3, 'global'), ['memory', 'printer']);
  assert.deepEqual(liveFamilies(2, 'global'), ['printer']);
});

test('the readability summary leaves the objdiff score to g6.objdiff (gate-honesty-r0-1, D68 a, D92)', () => {
  assert.equal(FAMILIES.readability.summary, 'readability shares only increase (objdiff: g6.objdiff, D92)');
  assert.equal(FAMILIES.readability.liveFrom, 3);
  for (const [name, spec] of Object.entries(FAMILIES)) assert.doesNotMatch(spec.summary, /objdiff score 0/, name);
});
