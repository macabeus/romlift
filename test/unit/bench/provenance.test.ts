import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { discoverGateFiles, parseGateFileName, tierOf, type GateFile } from '../../../bench/src/gate-files.ts';
import { provenanceChecks, readLanded, type ProvenanceInputs } from '../../../bench/src/provenance.ts';
import { dataset, meta, printerSummary, results, row, withTempDir } from './fixtures.ts';

const GATES: readonly GateFile[] = [
  { file: 'g1.real-one.test.ts', id: 'g1.real-one', phase: 1, tier: 'real' },
  { file: 'g1.both-one.test.ts', id: 'g1.both-one', phase: 1, tier: 'both' },
  { file: 'g1.ci-one.test.ts', id: 'g1.ci-one', phase: 1, tier: 'ci' },
  { file: 'g2.real-two.test.ts', id: 'g2.real-two', phase: 2, tier: 'real' },
];

function inputs(overrides: Partial<ProvenanceInputs> = {}): ProvenanceInputs {
  return {
    artifact: results([row()], { meta: meta({ families: { tiny: ['code-end', 'entries', 'extents', 'scaffold'] } }), printer: printerSummary() }),
    recomputedDigest: 's'.repeat(64),
    landed: 0,
    gates: GATES,
    datasets: [dataset()],
    ...overrides,
  };
}

const verdicts = (i: ProvenanceInputs): Record<string, boolean> => Object.fromEntries(provenanceChecks(i).map((c) => [c.id, c.ok]));

test('a current artifact passes every check at landed 0', () => {
  assert.deepEqual(verdicts(inputs()), { 'source-digest': true, 'gate-record': true, families: true, 'dataset-rows': true, 'heldout-rows': true });
});

test('a recomputed digest that differs fails with "re-run the real tier"', () => {
  const [digest] = provenanceChecks(inputs({ recomputedDigest: 't'.repeat(64) }));
  assert.equal(digest?.ok, false);
  assert.match(digest?.detail ?? '', /re-run the real tier/);
});

test('no artifact fails the digest and row checks', () => {
  const v = verdicts(inputs({ artifact: undefined }));
  assert.equal(v['source-digest'], false);
  assert.equal(v['dataset-rows'], false);
  assert.equal(v['heldout-rows'], true);
});

test('the gate record needs every real or both gate of a landed phase to pass or be historical', () => {
  const passing = results([row()], {
    gates: {
      real: [
        { id: 'g1.real-one', verdict: 'pass', inputs: {}, detail: '' },
        { id: 'g1.both-one', verdict: 'historical', inputs: {}, detail: '' },
      ],
    },
    printer: printerSummary(),
  });
  assert.equal(verdicts(inputs({ artifact: passing, landed: 1 }))['gate-record'], true);
  const pending = { ...passing, gates: { real: [{ id: 'g1.real-one', verdict: 'unavailable', inputs: {}, detail: '' }] } };
  const check = provenanceChecks(inputs({ artifact: pending, landed: 1 })).find((c) => c.id === 'gate-record');
  assert.equal(check?.ok, false);
  assert.match(check?.detail ?? '', /g1\.real-one is unavailable; g1\.both-one has no real-tier record/);
  // A gate whose tier cannot be read fails the check rather than being skipped.
  assert.equal(verdicts(inputs({ artifact: passing, landed: 1, gates: [{ file: 'g1.x.test.ts', id: 'g1.x', phase: 1 }] }))['gate-record'], false);
});

test('families: every live per-ROM family for every tuning ROM, and the printer from phase 1', () => {
  assert.equal(verdicts(inputs({ landed: 1 }))['families'], true);
  const noPrinter = results([row()]);
  assert.equal(verdicts(inputs({ artifact: noPrinter, landed: 1 }))['families'], false);
  assert.equal(verdicts(inputs({ artifact: noPrinter, landed: 0 }))['families'], true);
  const noScaffold = results([row()], { meta: meta({ families: { tiny: ['entries'] } }), printer: printerSummary() });
  assert.equal(verdicts(inputs({ artifact: noScaffold, landed: 1 }))['families'], false);
  assert.equal(verdicts(inputs({ landed: 2 }))['families'], false, 'determinism and speed are live at phase 2');
});

test('dataset-rows and heldout-rows', () => {
  assert.equal(verdicts(inputs({ datasets: [dataset(), dataset({ name: 'other' })] }))['dataset-rows'], false);
  const sealed = verdicts(inputs({ datasets: [dataset({ heldout: true })] }));
  assert.equal(sealed['heldout-rows'], false);
  assert.equal(sealed['dataset-rows'], true);
  assert.equal(verdicts(inputs({ datasets: [dataset({ heldout: true, revealed: [{ at: 'd', commit: 'c', reason: 'r' }] })] }))['heldout-rows'], true);
});

test('gate files: id and phase from the name, tier from the spec literal', async () => {
  assert.deepEqual(parseGateFileName('g3.text-layout.test.ts'), { id: 'g3.text-layout', phase: 3 });
  assert.equal(parseGateFileName('gate.ts'), undefined);
  assert.equal(parseGateFileName('g7.x.test.ts'), undefined);
  assert.equal(tierOf("gate({ id: 'g1.x', phase: 1, tier: 'real', needs: [] })"), 'real');
  assert.equal(tierOf('tier: "both"'), 'both');
  assert.equal(tierOf('tier: selected'), undefined);
  await withTempDir('romlift-gatefiles-', async (dir) => {
    await writeFile(join(dir, 'g2.b.test.ts'), "tier: 'ci'");
    await writeFile(join(dir, 'g1.a.test.ts'), "tier: 'real'");
    await writeFile(join(dir, 'gate.ts'), '');
    await writeFile(join(dir, 'phase.json'), '{"landed": 3}');
    assert.deepEqual(await discoverGateFiles(dir), [
      { file: 'g1.a.test.ts', id: 'g1.a', phase: 1, tier: 'real' },
      { file: 'g2.b.test.ts', id: 'g2.b', phase: 2, tier: 'ci' },
    ]);
    assert.equal(await readLanded(dir), 3);
    await writeFile(join(dir, 'phase.json'), '{"landed": "one"}');
    await assert.rejects(readLanded(dir), /landed/);
    assert.deepEqual(await discoverGateFiles(join(dir, 'missing')), []);
  });
});
