import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RomliftInvariantError } from '../../../../src/foundation/diagnostics/diagnostic.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { isRuleId } from '../../../../src/core/provenance/rule-id.ts';
import { resolveRules, RULES } from '../../../../src/core/analysis/driver/rules.ts';
import { analyze } from '../../../../src/core/analysis/driver/run.ts';
import type { RuleOracle } from '../../../../src/core/analysis/oracle.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { calls, extent, romEntry } from './fakes.ts';

const TUNING = { worklist: 'poc-lifo', cache: 'epoch', disabled: [] } as const;

test('RULES holds only well-formed ids, each registered under its meta.id (empty until the wave-1 rules land)', () => {
  for (const [id, rule] of Object.entries(RULES)) {
    assert.ok(isRuleId(id), id);
    assert.equal(rule.meta.id, id);
  }
});

test('a pipeline id without an implementation throws RomliftInvariantError', () => {
  const profile = testProfile({ seed: ['seed.rom-entry'] });
  assert.throws(() => resolveRules(profile, registry(), TUNING), RomliftInvariantError);
  assert.throws(() => analyze(romWith([]), AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }), /has no implementation/);
});

test('a disabled id is skipped, and a family the oracle answers needs no implementation', () => {
  const profile = testProfile({ seed: ['seed.rom-entry'], queue: ['seed.call'] });
  const reg = registry(calls);
  const gapIds = Object.values(profile.pipeline.gap).flat();
  const off = resolveRules(profile, reg, { ...TUNING, disabled: ['seed.rom-entry', ...gapIds] });
  assert.deepEqual(off.seed, []);
  assert.deepEqual(off.queue.map((q) => q.id), ['seed.call']);
  const oracle: RuleOracle = { answered: ['seed', 'gap'], ask: () => undefined, check: () => undefined, marker: () => undefined };
  const answered = resolveRules(profile, reg, { ...TUNING, oracle });
  assert.deepEqual(answered.seed, []);
  assert.deepEqual(answered.gap.forward, [undefined, undefined, undefined], 'the forward slot keeps its positions');
});

test('a rule of the wrong kind for its slot throws; bl rules split into verdicts and refinements', () => {
  const profile = testProfile({ seed: ['seed.call'] });
  assert.throws(() => resolveRules(profile, registry(calls), tuningFor(profile, registry(calls))), /is a 'queue' rule/);
  const verdict = fakeRule('bl.near-is-call', { kind: 'bl', decide: () => 'call' });
  const refine = fakeRule('bl.noreturn-before-noncode', { kind: 'bl', refines: true, decide: () => 'noreturn' });
  const p = testProfile({ bl: ['bl.near-is-call', 'bl.noreturn-before-noncode'] });
  const r = resolveRules(p, registry(verdict, refine), tuningFor(p, registry(verdict, refine)));
  assert.deepEqual(r.blVerdict.map((b) => b.id), ['bl.near-is-call']);
  assert.deepEqual(r.blRefine.map((b) => b.id), ['bl.noreturn-before-noncode']);
  assert.equal(r.rank.get('bl.noreturn-before-noncode'), 1);
});

test('origins come from the proposing rule; the extent rule is the first claim rule with extentEnd', () => {
  const p = testProfile({ seed: ['seed.rom-entry'], claim: ['claim.adjacent-pools'] });
  const reg = registry(romEntry, extent);
  const r = resolveRules(p, reg, tuningFor(p, reg));
  assert.equal(r.origin.get('seed.rom-entry'), 'rom-entry');
  assert.equal(r.extentEnd({ entry: 0, codeEnd: 10, pools: [12], tables: [] }, p), 16);
  const bare = resolveRules(testProfile(), registry(), tuningFor(testProfile(), registry()));
  assert.equal(bare.extentEnd({ entry: 0, codeEnd: 10, pools: [12], tables: [] }, p), 10, 'no extent rule: the code end');
});
