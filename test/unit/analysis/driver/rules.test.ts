import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES, resolveRules } from '../../../../src/core/analysis/driver/rules.ts';
import { analyze } from '../../../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { isRuleId } from '../../../../src/core/provenance/rule-id.ts';
import { RomliftInvariantError } from '../../../../src/foundation/diagnostics/diagnostic.ts';
import { fakeRule, pipelineIds, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { calls, extent, romEntry } from './fakes.ts';

const TUNING = { cache: 'epoch', disabled: [] } as const;

test('RULES holds only well-formed ids, each registered under its meta.id, and implements every agbcc pipeline id', () => {
  for (const [id, rule] of Object.entries(RULES)) {
    assert.ok(isRuleId(id), id);
    assert.equal(rule.meta.id, id);
  }
  assert.deepEqual(
    pipelineIds(AGBCC.pipeline).filter((id) => !Object.hasOwn(RULES, id)),
    [],
  );
});

test('a pipeline id without an implementation throws RomliftInvariantError', () => {
  const profile = testProfile({ seed: ['seed.rom-entry'] });
  assert.throws(() => resolveRules(profile, registry(), TUNING), RomliftInvariantError);
  assert.throws(
    () =>
      analyze(romWith([]), testProfile({ seed: ['seed.unimplemented'] }), {
        mode: 'discover',
        seeds: [],
        overrides: [],
        trail: 'off',
      }),
    /has no implementation/,
  );
});

test('a disabled id is skipped, and the forward slot keeps its pair by name', () => {
  const profile = testProfile({ seed: ['seed.rom-entry'], queue: ['seed.call'] });
  const reg = registry(calls);
  const g = profile.pipeline.gap;
  const gapIds = [
    g.absorb,
    g.head,
    g.forward.thumb,
    g.forward.arm,
    ...g.forward.after,
    g.prefer,
    g.skip,
    g.endAnchor,
    g.backward,
  ];
  const off = resolveRules(profile, reg, { ...TUNING, disabled: ['seed.rom-entry', ...gapIds] });
  assert.deepEqual(off.seed, []);
  assert.deepEqual(
    off.queue.map((q) => q.id),
    ['seed.call'],
  );
  assert.deepEqual(off.gap.forward, { after: [] }, 'a disabled pair member is absent, not shifted');
  assert.deepEqual(
    [
      off.rank.get(g.forward.thumb),
      off.rank.get(g.forward.arm),
      off.rank.get(g.forward.after[0] ?? 'gap.tiled-hole-inner'),
    ],
    [0, 1, 2],
    'the ranks are those of one list',
  );
  const armOnly = resolveRules(
    profile,
    registry(calls, fakeRule('gap.arm-scan', { kind: 'gap', propose: () => undefined })),
    { ...TUNING, disabled: ['seed.rom-entry', ...gapIds.filter((id) => id !== 'gap.arm-scan')] },
  );
  assert.equal(armOnly.gap.forward.arm?.id, 'gap.arm-scan', 'the ARM proposer is never taken for the Thumb one');
  assert.equal(armOnly.gap.forward.thumb, undefined);
});

test('a rule of the wrong kind for its slot throws; bl rules split into verdicts and refinements', () => {
  const profile = testProfile({ seed: ['seed.call'] });
  assert.throws(() => resolveRules(profile, registry(calls), tuningFor(profile, registry(calls))), /is a 'queue' rule/);
  const verdict = fakeRule('bl.near-is-call', { kind: 'bl', decide: () => 'call' });
  const refine = fakeRule('bl.noreturn-before-noncode', { kind: 'bl', refines: true, decide: () => 'noreturn' });
  const p = testProfile({ bl: ['bl.near-is-call', 'bl.noreturn-before-noncode'] });
  const r = resolveRules(p, registry(verdict, refine), tuningFor(p, registry(verdict, refine)));
  assert.deepEqual(
    r.blVerdict.map((b) => b.id),
    ['bl.near-is-call'],
  );
  assert.deepEqual(
    r.blRefine.map((b) => b.id),
    ['bl.noreturn-before-noncode'],
  );
  assert.equal(r.rank.get('bl.noreturn-before-noncode'), 1);
});

test('origins come from the proposing rule; the extent rule is the first claim rule with extentEnd', () => {
  const p = testProfile({ seed: ['seed.rom-entry'], claim: ['claim.adjacent-pools'] });
  const reg = registry(romEntry, extent);
  const r = resolveRules(p, reg, tuningFor(p, reg));
  assert.equal(r.origin.get('seed.rom-entry'), 'rom-entry');
  assert.equal(r.extentEnd({ entry: 0, codeEnd: 10, pools: [12], tables: [] }, p), 16);
  const bare = resolveRules(testProfile(), registry(), tuningFor(testProfile(), registry()));
  assert.equal(
    bare.extentEnd({ entry: 0, codeEnd: 10, pools: [12], tables: [] }, p),
    10,
    'no extent rule: the code end',
  );
});
