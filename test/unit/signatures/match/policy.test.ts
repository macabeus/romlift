// The matcher's policy (architecture §7.2, D7, D12): the PoC's constants, the rules in strength order with one sweep
// per stage, and the registry that explain and g6.explain-coverage read (exactly SIGNATURE_RULE_IDS, each with its
// metadata in its own file).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { familyOf } from '../../../../src/core/provenance/rule-id.ts';
import { matchSignatures } from '../../../../src/core/signatures/match.ts';
import { SIGNATURE_POLICY, SIGNATURE_RULE_ORDER } from '../../../../src/core/signatures/policy.ts';
import { PLACEMENT_RULES, SIGNATURE_RULES } from '../../../../src/core/signatures/rules/index.ts';
import { SIGNATURE_RULE_IDS } from '../../../../src/core/signatures/schema.ts';
import { RomliftInvariantError } from '../../../../src/foundation/diagnostics/diagnostic.ts';
import { romWith } from '../../../helpers/analysis.ts';
import { codeRange, distinct, signatureFile } from '../../../helpers/signatures.ts';

test("the policy holds the PoC's numbers (romlift-poc/src/signatures/apply.ts)", () => {
  const { stages, ...numbers } = SIGNATURE_POLICY;
  assert.deepEqual(numbers, { minUnmaskedBytes: 12, candidateCap: 256, window: 64, pinnedMinBytes: 32, maxDiffWords: 2, moduleNear: 256 });
  assert.equal(stages, SIGNATURE_RULE_ORDER);
});

test('the stages run every rule once, strongest first, and each stage shares one sweep', () => {
  assert.deepEqual(SIGNATURE_RULE_ORDER.flatMap((s) => s.rules), SIGNATURE_RULE_IDS);
  for (const stage of SIGNATURE_RULE_ORDER) assert.equal(new Set(stage.rules.map((id) => PLACEMENT_RULES[id].sweep)).size, 1, stage.rules.join(', '));
  assert.deepEqual(SIGNATURE_RULE_ORDER.map((s) => s.repeat), [false, false, true, true]);
});

test('the registry holds exactly the five rules, each with its own metadata', () => {
  assert.deepEqual(Object.keys(SIGNATURE_RULES).sort(), [...SIGNATURE_RULE_IDS].sort());
  for (const id of SIGNATURE_RULE_IDS) {
    const meta = SIGNATURE_RULES[id];
    assert.ok(meta !== undefined, id);
    assert.equal(meta.id, id);
    assert.equal(familyOf(meta.id), 'sig');
    assert.equal(PLACEMENT_RULES[id].meta, meta);
    assert.deepEqual(meta.reads, ['rom', 'placements']);
    assert.deepEqual(meta.adds, ['placements']);
    for (const text of [meta.summary, meta.restsOn, meta.recovers]) assert.ok(text.length > 20, `${id}: ${text}`);
  }
});

test('a stage mixing sweeps is a broken invariant', () => {
  const fn = { name: 'F', bytes: distinct(1, 32) };
  const rom = romWith([{ at: 0x0800_1000, bytes: fn.bytes }]);
  const policy = { ...SIGNATURE_POLICY, stages: [{ rules: ['sig.unique-fit', 'sig.link-order-run'] as const, repeat: false }] };
  assert.throws(() => matchSignatures(rom, codeRange(0x0800_0100, 0x0801_0000), [signatureFile('lib', { id: '1', members: [fn] })], policy), RomliftInvariantError);
});
