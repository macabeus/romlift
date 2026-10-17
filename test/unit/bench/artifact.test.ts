import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseResults, parseResultsText, resultsText } from '../../../bench/src/artifact.ts';
import { FAMILIES, liveFamilies, PHASE1_ROM_FAMILIES } from '../../../bench/src/families.ts';
import { keptGates } from '../../../bench/src/run.ts';
import { meta, results, row } from './fixtures.ts';

test('resultsText sorts rows by name and gate records by id, and round-trips', () => {
  const r = results([row({ name: 'sa2' }), row({ name: 'fe7j' })], {
    gates: { real: [{ id: 'g1.z', verdict: 'pass', inputs: {}, detail: '' }, { id: 'g1.a', verdict: 'pass', inputs: {}, detail: '' }] },
  });
  const text = resultsText(r);
  const parsed = parseResultsText(text, 'x');
  assert.deepEqual(parsed.roms.map((x) => x.name), ['fe7j', 'sa2']);
  assert.deepEqual(parsed.gates.real.map((g) => g.id), ['g1.a', 'g1.z']);
  assert.equal(resultsText(parsed), text);
  assert.ok(!/generatedAt|seconds/.test(text), 'no volatile value in results.json');
  assert.ok(text.endsWith('}\n'));
});

test('parseResults rejects an artifact without its provenance', () => {
  assert.throws(() => parseResults({ meta: { ...meta(), sourceDigest: 1 }, roms: [] }, 'x'), /sourceDigest/);
  assert.throws(() => parseResults({ meta: meta(), roms: [{ name: 'a' }] }, 'x'), /tp must be a number/);
  assert.throws(() => parseResultsText('{', 'x'), /not JSON/);
  assert.deepEqual(parseResults({ meta: meta(), roms: [] }, 'x').gates.real, []);
});

test('the gate record is kept only when the source digest and inputs are unchanged', () => {
  const gates = [{ id: 'g1.a', verdict: 'pass', inputs: {}, detail: '' }];
  const previous = results([row()], { gates: { real: gates } });
  assert.deepEqual(keptGates(previous, previous.meta), gates);
  assert.deepEqual(keptGates(previous, { ...previous.meta, sourceDigest: 'other' }), []);
  assert.deepEqual(keptGates(previous, { ...previous.meta, inputs: { ...previous.meta.inputs, pocSourceDigest: 'other' } }), []);
  assert.deepEqual(keptGates(undefined, previous.meta), []);
});

test('families: printer and scaffold from phase 1, entries, extents and code end from phase 2', () => {
  assert.deepEqual(liveFamilies(0, 'rom'), []);
  assert.deepEqual(liveFamilies(1, 'rom'), ['scaffold']);
  assert.deepEqual(liveFamilies(1, 'global'), ['printer']);
  assert.deepEqual(liveFamilies(2, 'rom'), ['code-end', 'determinism', 'entries', 'extents', 'scaffold', 'speed']);
  assert.equal(FAMILIES['held-out'].scope, 'sealed');
  for (const f of PHASE1_ROM_FAMILIES) assert.equal(FAMILIES[f].scope, 'rom');
});
