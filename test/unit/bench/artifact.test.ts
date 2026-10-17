import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseResults, parseResultsText, resultsText } from '../../../bench/src/artifact.ts';
import { FAMILIES, liveFamilies, PHASE1_ROM_FAMILIES } from '../../../bench/src/families.ts';
import { keptGates } from '../../../bench/src/run.ts';
import { meta, results, row } from './fixtures.ts';
import { PARITY_EVIDENCE_SCHEMA, type ParityEvidence } from '../../../bench/src/parity-evidence.ts';

const EVIDENCE: ParityEvidence = {
  schema: PARITY_EVIDENCE_SCHEMA,
  commit: 'c'.repeat(40),
  dirty: false,
  worklist: 'poc-lifo',
  pocSourceDigest: 'd'.repeat(64),
  roms: {
    tiny: {
      digest: 'b'.repeat(64),
      expected: 'b'.repeat(64),
      rowDiffs: 0,
      lockstep: [{ set: 'all', real: ['seed', 'walk'], queries: 3, matched: 3, answered: 0, compared: 2, markers: 1, skipped: 0, recalled: 0, parityDigest: 'b'.repeat(64), divergence: null }],
    },
  },
};

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
  assert.throws(() => parseResults({ meta: meta(), roms: [{ name: 'a' }] }, 'x'), /row a\.startup: must be an object/);
  // Every BenchRow field is checked, not only a few: a row parses back to itself, and each break names its field.
  const good = row();
  assert.deepEqual(parseResults({ meta: meta(), roms: [good] }, 'x').roms, [good]);
  assert.throws(() => parseResults({ meta: meta(), roms: [{ ...good, precision: 'high' }] }, 'x'), /row tiny\.precision: must be a number/);
  assert.throws(() => parseResults({ meta: meta(), roms: [{ ...good, startup: { end: 1 } }] }, 'x'), /row tiny\.startup\.end: must be a string/);
  assert.throws(() => parseResults({ meta: meta(), roms: [{ ...good, scaffold: {} }] }, 'x'), /row tiny\.scaffold\.ok: must be a boolean/);
  const miss = { addr: '0x08000400', name: 'x', size: 4, reason: 'inside code', listed: false };
  assert.throws(() => parseResults({ meta: meta(), roms: [{ ...good, misses: [miss] }] }, 'x'), /'inside code' is not a miss reason/);
  assert.throws(() => parseResults({ meta: { ...meta(), inputs: { tiny: { sha1: 'a' } } }, roms: [] }, 'x'), /meta\.inputs\.tiny\.elfSha256: must be a string/);
  assert.throws(() => parseResults({ meta: meta(), printer: { schema: 'romlift/corpus-summary@1' }, roms: [] }, 'x'), /printer: sections is not an object/);
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

test('a romlift row with every phase-2 field, the sealed counts and the parity evidence round-trip', () => {
  const full = {
    ...row({ extents: { sized: 10, agree: 10, mismatches: [], lost: [{ addr: '0x08000300', name: 'big', elf: 64, found: 48 }] } }),
    analysisDigest: 'a'.repeat(64),
    poc: { tp: 9 },
    staleExceptions: [{ list: 'labels' as const, addr: '0x08000400' }],
    baselineRows: { diffs: [{ kind: 'miss-removed', addr: '0x08000500' }], unaccepted: [], staleAccepted: [] },
    parity: { digest: 'b'.repeat(64), expected: 'b'.repeat(64) },
  };
  const sealed = {
    name: 'held',
    entries: 3,
    elfFunctions: 3,
    tp: 3,
    glued: 0,
    labelCandidates: 0,
    falseEntries: { startup: 0, veneer: 0, adrCallback: 0, insideElfFunction: 0 },
    extents: { sized: 2, agree: 2 },
    codeEnd: { delta: 0 },
    pass: true,
  };
  const r = results([full], { meta: meta({ source: 'romlift', profile: 'agbcc' }), sealed: [sealed], parity: EVIDENCE });
  const text = resultsText(r);
  const parsed = parseResultsText(text, 'x');
  assert.deepEqual(parsed, r);
  assert.equal(resultsText(parsed), text);
  assert.deepEqual(Object.keys(JSON.parse(text) as object), ['meta', 'gates', 'roms', 'sealed', 'parity']);
  // A row without a scaffold verdict parses; a sealed entry carrying an address or a list is refused.
  const { scaffold: _scaffold, ...bare } = full;
  assert.equal(parseResults({ meta: meta(), roms: [bare] }, 'x').roms[0]?.scaffold, undefined);
  assert.throws(() => parseResults({ meta: meta(), roms: [], sealed: [{ ...sealed, codeEnd: { delta: 0x0800_0000 } }] }, 'x'), /sealed\[0\]: sealed field codeEnd\.delta is not a count/);
  assert.throws(() => parseResults({ meta: meta(), roms: [], sealed: [{ ...sealed, misses: ['0x08000100'] }] }, 'x'), /sealed field misses is not a count/);
  assert.throws(() => parseResults({ meta: meta(), roms: [], parity: { ...EVIDENCE, worklist: 'ascending' } }, 'x'), /parity\.worklist: must be 'poc-lifo'/);
  assert.throws(() => parseResults({ meta: meta(), roms: [{ ...full, staleExceptions: [{ list: 'other', addr: '0x08000400' }] }] }, 'x'), /staleExceptions\[0\]\.list: must be labels or untyped/);
});
