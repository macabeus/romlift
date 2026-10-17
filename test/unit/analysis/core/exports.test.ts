// The phase-2 surface through the package entry points (D37): what the gates and the bench call.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';
import * as internal from 'romlift/internal';

test('romlift exports the profiles, analyze and the address map', () => {
  for (const name of ['PROFILES', 'profileById', 'analyze', 'addressMap', 'toRun', 'toLoad', 'Claim', 'ALL_CODES', 'AnalysisCodes', 'MISS_REASONS', 'ORIGINS']) {
    assert.ok(name in romlift, name);
  }
  assert.equal(romlift.profileById('agbcc')?.id, 'agbcc');
});

test('romlift/internal exports the tuned analysis, the registry, the diagnosis and the reading builder', () => {
  for (const name of ['analyzeTuned', 'runAnalysis', 'DEFAULT_TUNING', 'RULES', 'resolveRules', 'diagnoseMisses', 'diagnoseMiss', 'makeReading', 'defineRule', 'buildPointerIndex', 'LIMITS']) {
    assert.ok(name in internal, name);
  }
  assert.deepEqual(internal.DEFAULT_TUNING, { worklist: 'ascending', cache: 'epoch', disabled: [] });
});
