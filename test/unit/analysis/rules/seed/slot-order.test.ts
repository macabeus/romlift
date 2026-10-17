// The seed family: each rule in the agbcc slot its contract names, with the origin assigned in
// core/analysis/types.ts; and RULES carries the 26 seed, validity and acceptance rules with complete
// metadata.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../../src/core/analysis/driver/rules.ts';
import { SEED_RULES } from '../../../../../src/core/analysis/rules/seed/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { isOrigin } from '../../../../../src/core/provenance/vocabulary.ts';

const SLOTS = {
  seed: [
    ['seed.rom-entry', 'rom-entry'],
    ['seed.startup-pointer', 'startup-pointer'],
    ['seed.listed', 'listed'],
    ['seed.override', 'override'],
    ['seed.evidence-hint', 'evidence'],
  ],
  harvest: [
    ['seed.pool-pointer', 'pool-pointer'],
    ['seed.data-pointer', 'data-pointer'],
  ],
  queue: [
    ['seed.call', 'call'],
    ['seed.veneer', 'veneer'],
    ['seed.adr', 'adr'],
    ['seed.ram-copy', 'ram-copy'],
  ],
} as const;

test('each seed rule sits in its agbcc slot, in the PoC order, with its contract kind and origin', () => {
  for (const kind of ['seed', 'harvest', 'queue'] as const) {
    assert.deepEqual(AGBCC.pipeline[kind], SLOTS[kind].map(([id]) => id), kind);
    for (const [id, origin] of SLOTS[kind]) {
      const rule = SEED_RULES[id];
      assert.equal(rule.kind, kind, id);
      assert.equal(rule.meta.id, id);
      assert.equal(rule.meta.origin, origin, id);
    }
  }
  assert.equal(Object.keys(SEED_RULES).length, 11);
});

test('RULES carries the seed, validity and acceptance rules with complete metadata', () => {
  const ids = Object.keys(RULES).filter((id) => /^(seed|valid|accept)\./.test(id));
  assert.equal(ids.length, 26);
  for (const id of ids) {
    const meta = RULES[id as keyof typeof RULES]?.meta;
    assert.ok(meta !== undefined, id);
    assert.equal(meta.id, id);
    for (const text of [meta.summary, meta.restsOn, meta.recovers]) assert.ok(text.trim().length > 0, id);
    assert.ok(Array.isArray(meta.reads) && Array.isArray(meta.adds), id);
    if (id.startsWith('seed.')) assert.ok(meta.origin !== undefined && isOrigin(meta.origin), id);
  }
});
