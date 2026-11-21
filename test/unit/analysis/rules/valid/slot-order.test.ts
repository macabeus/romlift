// The validity slot of agbcc is the PoC's whyInvalid() order, and each validity rule carries the reason
// and the intrinsic flag the contract assigns (core/analysis/types.ts, ValidityRule).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VALID_RULES } from '../../../../../src/core/analysis/rules/valid/index.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';

const WHY_INVALID = [
  ['valid.in-rom-unclaimed', 'inside-code', true],
  ['valid.decodes', 'decode-error', true],
  ['valid.balanced-stack', 'pops-frame', true],
  ['valid.returns-or-prologue', 'no-return-no-prologue', true],
  ['valid.no-claimed-code', 'pool-claimed', true],
  ['valid.pool-not-code', 'pool-claimed', true],
  ['valid.not-pointer-table', 'pointer-table', true],
  ['valid.dense', 'not-dense', true],
  ['valid.calls-code', 'calls-non-code', false],
] as const;

test('the agbcc validity slot is whyInvalid() in its order', () => {
  assert.deepEqual(
    AGBCC.pipeline.validity,
    WHY_INVALID.map(([id]) => id),
  );
});

test('every validity rule is registered with its contract reason and intrinsic flag', () => {
  assert.deepEqual(Object.keys(VALID_RULES).sort(), WHY_INVALID.map(([id]) => id).sort());
  for (const [id, reason, intrinsic] of WHY_INVALID) {
    const rule = VALID_RULES[id];
    assert.equal(rule.meta.id, id);
    assert.equal(rule.kind, 'valid');
    assert.deepEqual([rule.reason, rule.intrinsic], [reason, intrinsic], id);
  }
  assert.ok(VALID_RULES['valid.in-rom-unclaimed'].checkEntry !== undefined, 'the entry is judged before any reading');
});
