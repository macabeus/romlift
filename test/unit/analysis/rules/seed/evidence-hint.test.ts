import assert from 'node:assert/strict';
import { test } from 'node:test';

import evidenceHint from '../../../../../src/core/analysis/rules/seed/evidence-hint.ts';
import type { AnalysisView, Seed } from '../../../../../src/core/analysis/types.ts';
import { romWith, viewWith } from '../../../../helpers/analysis.ts';

function viewOf(seeds: readonly Seed[]): AnalysisView {
  return { ...viewWith({ rom: romWith([]) }), seeds };
}

test('the seeds of rule seed.evidence-hint, sorted by entry, Thumb before ARM at one address', () => {
  const seeds: Seed[] = [
    { entry: 0x0800_0300, mode: 'arm', rule: 'seed.evidence-hint' },
    { entry: 0x0800_0200, mode: 'thumb', rule: 'seed.evidence-hint', name: 'two' },
    { entry: 0x0800_0300, mode: 'thumb', rule: 'seed.evidence-hint' },
    { entry: 0x0800_0100, mode: 'thumb', rule: 'seed.listed' },
  ];
  assert.deepEqual(evidenceHint.seeds(viewOf(seeds)), [
    { entry: 0x0800_0200, mode: 'thumb', cites: [0x0800_0200] },
    { entry: 0x0800_0300, mode: 'thumb', cites: [0x0800_0300] },
    { entry: 0x0800_0300, mode: 'arm', cites: [0x0800_0300] },
  ]);
});

test('a bare discover run (no seeds) proposes nothing', () => {
  assert.deepEqual(evidenceHint.seeds(viewOf([])), []);
  assert.equal(evidenceHint.meta.origin, 'evidence');
});
