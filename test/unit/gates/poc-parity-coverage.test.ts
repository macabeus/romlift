// parityCoverageProblems, what g2.poc-parity checks once historical (test/gates/poc-parity-coverage.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parityCoverageProblems, SCOPED_OUT } from '../../gates/poc-parity-coverage.ts';

const FIVE = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'];

test('parityCoverageProblems: evidence for every tuning ROM covers; a ROM without evidence or digest does not', () => {
  assert.deepEqual(parityCoverageProblems({ evidenceRoms: FIVE, digestRoms: FIVE }, FIVE), []);
  assert.deepEqual(parityCoverageProblems({ evidenceRoms: FIVE, digestRoms: FIVE }, [...FIVE, 'tmc']), ['tmc: no parity evidence and no committed PoC digest']);
  assert.deepEqual(parityCoverageProblems({ evidenceRoms: [...FIVE, 'tmc'], digestRoms: FIVE }, [...FIVE, 'tmc']), ['tmc: no committed PoC digest']);
});

test('parityCoverageProblems: only an owner scoping passes a ROM without evidence, and none exists yet (Q1)', () => {
  assert.deepEqual(parityCoverageProblems({ evidenceRoms: FIVE, digestRoms: FIVE }, [...FIVE, 'tmc'], { tmc: 'decision' }), []);
  assert.deepEqual(SCOPED_OUT, {});
});
