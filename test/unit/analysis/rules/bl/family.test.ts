// The bl family: seven rules, one file each, in agbcc's bl slot; only the last refines a verdict.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../../src/core/analysis/driver/rules.ts';
import { BL_RULES } from '../../../../../src/core/analysis/rules/bl/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { checkFamily } from '../walk/family-check.ts';

test('the bl family matches its slot, its files and RULES', async () => {
  await checkFamily('bl', BL_RULES, AGBCC.pipeline.bl);
  for (const [id, rule] of Object.entries(BL_RULES)) assert.equal(RULES[id as keyof typeof BL_RULES], rule);
  const refining = Object.values(BL_RULES)
    .filter((r) => r.refines === true)
    .map((r) => r.meta.id);
  assert.deepEqual(refining, ['bl.noreturn-before-noncode']);
});
