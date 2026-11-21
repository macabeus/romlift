// The region family's registry: every rule under its own id, with complete metadata, in the region slot
// of both profiles, and registered in RULES.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../../src/core/analysis/driver/rules.ts';
import { REGION_RULES } from '../../../../../src/core/analysis/rules/region/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { DUMMY_PROFILE } from '../../../../helpers/dummy-profile.ts';

test('three region rules, each under its meta id, with complete metadata, in the region slot, in RULES', () => {
  const ids = ['region.data-after-code', 'region.padding', 'region.startup'] as const;
  assert.deepEqual(Object.keys(REGION_RULES).sort(), [...ids]);
  for (const id of ids) {
    const rule = REGION_RULES[id];
    assert.equal(rule.meta.id, id);
    assert.equal(rule.kind, 'region');
    for (const field of [rule.meta.summary, rule.meta.restsOn, rule.meta.recovers])
      assert.ok(field.trim().length > 0, id);
    assert.ok(rule.meta.adds.length > 0, id);
    assert.equal(RULES[id], rule);
    for (const profile of [AGBCC, DUMMY_PROFILE])
      assert.ok(profile.pipeline.region.includes(id), `${profile.id}: ${id}`);
  }
  assert.equal(
    typeof REGION_RULES['region.startup'].startup,
    'function',
    'the startup rule answers the startup region',
  );
});
