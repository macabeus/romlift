import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AnalysisCodes } from '../../../../src/core/analysis/codes.ts';
import { candidateBudget, fixpointLimit, LIMITS, settleLimit } from '../../../../src/core/analysis/limits.ts';

test("the limits are the PoC's settle cap and two safety bounds", () => {
  assert.equal(LIMITS.settleRounds, 600);
  assert.ok(LIMITS.fixpointRounds > 0);
  assert.ok(LIMITS.candidateBudget > 0);
});

test('each limit raises a warning, never an error', () => {
  const s = settleLimit(0x0800_0100, 600);
  assert.equal(s.code, 'W_SETTLE_LIMIT');
  assert.equal(s.severity, 'warning');
  assert.equal(s.addr, 0x0800_0100);
  assert.match(s.message, /0x08000100.*600 rounds/);
  assert.equal(fixpointLimit('grow', 10).code, 'W_FIXPOINT_LIMIT');
  assert.equal(candidateBudget(3, 9, 8).code, 'W_CANDIDATE_BUDGET');
  for (const spec of Object.values(AnalysisCodes)) assert.equal(spec.severity, 'warning');
});
