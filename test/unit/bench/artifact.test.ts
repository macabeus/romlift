import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseResults, parseResultsText, resultsText } from '../../../bench/src/artifact.ts';
import { FAMILIES, PHASE1_ROM_FAMILIES, liveFamilies } from '../../../bench/src/families.ts';
import { PARITY_EVIDENCE_SCHEMA, type ParityEvidence } from '../../../bench/src/parity-evidence.ts';
import { keptGates } from '../../../bench/src/run.ts';
import { meta, results, row } from './fixtures.ts';

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
      lockstep: [
        {
          set: 'all',
          real: ['seed', 'walk'],
          queries: 3,
          matched: 3,
          answered: 0,
          compared: 2,
          markers: 1,
          skipped: 0,
          recalled: 0,
          parityDigest: 'b'.repeat(64),
          divergence: null,
        },
      ],
    },
  },
};

test('resultsText sorts rows by name and gate records by id, and round-trips', () => {
  const r = results([row({ name: 'sa2' }), row({ name: 'fe7j' })], {
    gates: {
      real: [
        { id: 'g1.z', verdict: 'pass', inputs: {}, detail: '' },
        { id: 'g1.a', verdict: 'pass', inputs: {}, detail: '' },
      ],
    },
  });
  const text = resultsText(r);
  const parsed = parseResultsText(text, 'x');
  assert.deepEqual(
    parsed.roms.map((x) => x.name),
    ['fe7j', 'sa2'],
  );
  assert.deepEqual(
    parsed.gates.real.map((g) => g.id),
    ['g1.a', 'g1.z'],
  );
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
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...good, precision: 'high' }] }, 'x'),
    /row tiny\.precision: must be a number/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...good, startup: { end: 1 } }] }, 'x'),
    /row tiny\.startup\.end: must be a string/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...good, scaffold: {} }] }, 'x'),
    /row tiny\.scaffold\.ok: must be a boolean/,
  );
  const miss = { addr: '0x08000400', name: 'x', size: 4, reason: 'inside code', listed: false };
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...good, misses: [miss] }] }, 'x'),
    /'inside code' is not a miss reason/,
  );
  assert.throws(
    () => parseResults({ meta: { ...meta(), inputs: { tiny: { sha1: 'a' } } }, roms: [] }, 'x'),
    /meta\.inputs\.tiny\.elfSha256: must be a string/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), printer: { schema: 'romlift/corpus-summary@1' }, roms: [] }, 'x'),
    /printer: sections is not an object/,
  );
  assert.throws(() => parseResultsText('{', 'x'), /not JSON/);
  assert.deepEqual(parseResults({ meta: meta(), roms: [] }, 'x').gates.real, []);
});

test('the gate record is kept only when the source digest and inputs are unchanged', () => {
  const gates = [{ id: 'g1.a', verdict: 'pass', inputs: {}, detail: '' }];
  const previous = results([row()], { gates: { real: gates } });
  assert.deepEqual(keptGates(previous, previous.meta), gates);
  assert.deepEqual(keptGates(previous, { ...previous.meta, sourceDigest: 'other' }), []);
  assert.deepEqual(
    keptGates(previous, { ...previous.meta, inputs: { ...previous.meta.inputs, pocSourceDigest: 'other' } }),
    [],
  );
  assert.deepEqual(keptGates(undefined, previous.meta), []);
});

test('a phase-3 row and artifact round-trip: readability, objdiff, the tree digest, the memory member, objdiff-cli and the objects digest', () => {
  const shares = { mnemonicShare: 0.99, symbolicBranchShare: 1, symbolicPoolShare: 0.5 };
  const objdiff = {
    linked: true,
    scored: 4,
    differences: { relocation: 1, 'unnamed-target': 2 },
    examples: [{ function: 'f', kind: 'relocation', detail: '+0x4 R_ARM_ABS32: a | b' }],
  };
  const phase3 = row({ readability: { ...shares, floor: null }, objdiff, treeDigest: 't'.repeat(64) });
  const floored = row({ name: 'sa2', readability: { ...shares, floor: shares } });
  const memory = {
    romBytes: 33554432,
    sha1: 'b'.repeat(40),
    runs: [
      { command: 'init', exitCode: 0, maxRssMiB: 300.5 },
      { command: 'generate', exitCode: 0, maxRssMiB: 280, treeDigest: 'c'.repeat(64) },
    ],
  };
  const m = meta({
    toolchain: {
      as: 'GNU assembler 2.45',
      ld: 'GNU ld 2.45',
      objcopy: 'GNU objcopy 2.45',
      objdiff: 'objdiff-cli 3.7.2',
    },
    inputs: { tiny: { sha1: 'a', elfSha256: 'b', objectsDigest: 'o'.repeat(64) }, pocSourceDigest: 'p' },
  });
  const r = results([phase3, floored], { meta: m, memory });
  const text = resultsText(r);
  assert.deepEqual(parseResultsText(text, 'x'), { ...r, roms: [floored, phase3] });
  assert.deepEqual(Object.keys(JSON.parse(text) as object), ['meta', 'memory', 'gates', 'roms']);
  // From D102 the member carries its classes; an artifact without them (written before) still reads.
  const classes = {
    counts: { 'relocation-other': 1, 'unnamed-target': 2 },
    gated: 1,
    uncompared: 0,
    gatedExamples: [{ function: 'f', kind: 'relocation-other', detail: '+0x4 R_ARM_ABS32: a | b' }],
  };
  const classed = results(
    [row({ readability: { ...shares, floor: null }, objdiff: { ...objdiff, classes }, treeDigest: 't'.repeat(64) })],
    { meta: m },
  );
  assert.deepEqual(parseResultsText(resultsText(classed), 'x'), classed);
  assert.throws(
    () =>
      parseResults(
        { meta: meta(), roms: [{ ...phase3, objdiff: { ...objdiff, classes: { ...classes, gated: 'one' } } }] },
        'x',
      ),
    /objdiff\.classes\.gated: must be a number/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...phase3, objdiff: { ...objdiff, linked: 'yes' } }] }, 'x'),
    /objdiff\.linked: must be a boolean/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [{ ...phase3, readability: { ...shares } }] }, 'x'),
    /readability\.floor: must be an object/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [], memory: { ...memory, runs: [{ command: 'init' }] } }, 'x'),
    /memory\.runs\[0\]\.exitCode: must be a number/,
  );
  // A phase-2 artifact (no objdiff-cli, no phase-3 member) still reads: it is a regression base.
  const old = parseResults({ meta: meta(), roms: [row()] }, 'x');
  assert.equal(old.meta.toolchain.objdiff, undefined);
  assert.equal(old.memory, undefined);
  assert.equal(old.roms[0]?.readability, undefined);
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
    ...row({
      extents: {
        sized: 10,
        agree: 10,
        mismatches: [],
        lost: [{ addr: '0x08000300', name: 'big', elf: 64, found: 48 }],
      },
    }),
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
  const r = results([full], {
    meta: meta({ source: 'romlift', profile: 'agbcc' }),
    sealed: [sealed],
    parity: EVIDENCE,
  });
  const text = resultsText(r);
  const parsed = parseResultsText(text, 'x');
  assert.deepEqual(parsed, r);
  assert.equal(resultsText(parsed), text);
  assert.deepEqual(Object.keys(JSON.parse(text) as object), ['meta', 'gates', 'roms', 'sealed', 'parity']);
  // A row without a scaffold verdict parses; a sealed entry carrying an address or a list is refused.
  const { scaffold: _scaffold, ...bare } = full;
  assert.equal(parseResults({ meta: meta(), roms: [bare] }, 'x').roms[0]?.scaffold, undefined);
  assert.throws(
    () => parseResults({ meta: meta(), roms: [], sealed: [{ ...sealed, codeEnd: { delta: 0x0800_0000 } }] }, 'x'),
    /sealed\[0\]: sealed field codeEnd\.delta is not a count/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [], sealed: [{ ...sealed, misses: ['0x08000100'] }] }, 'x'),
    /sealed field misses is not a count/,
  );
  assert.throws(
    () => parseResults({ meta: meta(), roms: [], parity: { ...EVIDENCE, worklist: 'ascending' } }, 'x'),
    /parity\.worklist: must be 'poc-lifo'/,
  );
  assert.throws(
    () =>
      parseResults(
        { meta: meta(), roms: [{ ...full, staleExceptions: [{ list: 'other', addr: '0x08000400' }] }] },
        'x',
      ),
    /staleExceptions\[0\]\.list: must be labels or untyped/,
  );
});
