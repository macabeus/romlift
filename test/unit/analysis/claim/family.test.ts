// The claim family: three rules, one file each, in agbcc's claim slot; only the first owns the extent.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RULES } from '../../../../src/core/analysis/driver/rules.ts';
import { CLAIM_RULES } from '../../../../src/core/analysis/rules/claim/index.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { checkFamily } from '../walk/family-check.ts';

test('the claim family matches its slot, its files and RULES', async () => {
  await checkFamily('claim', CLAIM_RULES, AGBCC.pipeline.claim);
  for (const [id, rule] of Object.entries(CLAIM_RULES)) assert.equal(RULES[id as keyof typeof CLAIM_RULES], rule);
  const extent = Object.values(CLAIM_RULES).filter((r) => r.extentEnd !== undefined).map((r) => r.meta.id);
  assert.deepEqual(extent, ['claim.adjacent-pools']);
});
