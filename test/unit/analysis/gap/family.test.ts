// The gap family's registry: every rule under its own id, with complete metadata and its origin, of the
// contract kind its slot in the agbcc and dummy pipelines expects, and registered in RULES.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../src/core/analysis/driver/rules.ts';
import { GAP_RULES } from '../../../../src/core/analysis/rules/gap/index.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { isOrigin } from '../../../../src/core/provenance/vocabulary.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';

const EXPECTED = {
  'gap.adr-block-absorb': ['gap-absorb', 'gap-scan'],
  'gap.tiled-hole': ['gap-head', 'tiled-hole'],
  'gap.tiled-hole-inner': ['gap', 'tiled-hole'],
  'gap.forward-chain': ['gap', 'gap-scan'],
  'gap.arm-scan': ['gap', 'arm-gap-scan'],
  'gap.end-anchor': ['gap', 'gap-scan'],
  'gap.backward-prologue-chain': ['gap', 'gap-scan'],
  'gap.arm-over-prologueless-thumb': ['gap-prefer', 'arm-gap-scan'],
  'gap.skip-padding-and-pointers': ['gap-skip', 'gap-scan'],
} as const;

test('nine gap rules, each under its meta id, with complete metadata, its kind and its origin', () => {
  assert.deepEqual(Object.keys(GAP_RULES).sort(), Object.keys(EXPECTED).sort());
  for (const [id, [kind, origin]] of Object.entries(EXPECTED)) {
    const rule = GAP_RULES[id as keyof typeof GAP_RULES];
    assert.equal(rule.meta.id, id);
    assert.equal(rule.kind, kind, id);
    assert.equal(rule.meta.origin, origin, id);
    assert.ok(isOrigin(rule.meta.origin ?? ''), id);
    for (const field of [rule.meta.summary, rule.meta.restsOn, rule.meta.recovers]) assert.ok(field.trim().length > 0, id);
    assert.ok(rule.meta.reads.length > 0, id);
    assert.equal(RULES[id as keyof typeof RULES], rule, `${id} is registered in RULES`);
  }
  assert.equal(GAP_RULES['gap.arm-scan'].reason, 'arm-unreached');
});

test('each gap rule fills the slot both profiles name it in', () => {
  for (const profile of [AGBCC, DUMMY_PROFILE]) {
    const g = profile.pipeline.gap;
    assert.equal(GAP_RULES[g.absorb as keyof typeof GAP_RULES]?.kind, 'gap-absorb');
    assert.equal(GAP_RULES[g.head as keyof typeof GAP_RULES]?.kind, 'gap-head');
    assert.equal(GAP_RULES[g.prefer as keyof typeof GAP_RULES]?.kind, 'gap-prefer');
    assert.equal(GAP_RULES[g.skip as keyof typeof GAP_RULES]?.kind, 'gap-skip');
    for (const id of [...g.forward, g.endAnchor, g.backward]) assert.equal(GAP_RULES[id as keyof typeof GAP_RULES]?.kind, 'gap', id);
  }
});
