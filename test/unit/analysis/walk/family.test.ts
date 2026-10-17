// The walk family: nine rules, one file each, in agbcc's walk slot, registered in RULES.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RULES } from '../../../../src/core/analysis/driver/rules.ts';
import { WALK_RULES } from '../../../../src/core/analysis/rules/walk/index.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { checkFamily } from './family-check.ts';

test('the walk family matches its slot, its files and RULES', async () => {
  await checkFamily('walk', WALK_RULES, AGBCC.pipeline.walk);
  for (const [id, rule] of Object.entries(WALK_RULES)) assert.equal(RULES[id as keyof typeof WALK_RULES], rule);
});
