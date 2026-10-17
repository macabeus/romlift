// bl.near-is-call: a bl closer than farJump.minDistance (1,536 bytes) is a call (settle()'s
// `Math.abs(target - site) < FAR_MIN`, through the profile's matchFarJump idiom).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { readingOf, romWith, testProfile, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const S = F + 2;
const ID = 'bl.near-is-call';

test('1,535 bytes away is a call, 1,536 is not, in both directions', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }], { size: 0x1000 });
  const caller = readingOf(rom, { entry: F });
  const v = viewWith({ rom });
  const rule = blRule(ID);
  assert.equal(AGBCC.farJump.minDistance, 1536);
  assert.equal(rule.decide({ site: S, target: S + 1535 }, caller, v), 'call');
  assert.equal(rule.decide({ site: S, target: S + 1536 }, caller, v), undefined);
  assert.equal(rule.decide({ site: S + 1536, target: S + 1 }, caller, v), 'call');
  assert.equal(rule.decide({ site: S + 1536, target: S }, caller, v), undefined);
});

test("the profile's idiom decides: one that never matches a far jump makes every bl a call", () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }], { size: 0x1000 });
  const never = { ...testProfile(), idioms: { ...AGBCC.idioms, matchFarJump: () => false } };
  assert.equal(blRule(ID).decide({ site: S, target: S + 0x800 }, readingOf(rom, { entry: F }), viewWith({ rom, profile: never })), 'call');
});

test('a near bl to code that pops an unpushed frame is a call; without the rule it reads as a far jump', () => {
  const near = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; bl _08000400; pop {pc}` }, { at: F + 0x200, bytes: thumbAt(F + 0x200)`pop {pc}` }]);
  assert.deepEqual(settle(driverOver(near), F).blVerdicts, [{ site: S, target: F + 0x200, verdict: 'call', rule: ID }]);
  assert.deepEqual(settle(driverOver(near, ID), F).blVerdicts.map((v) => [v.verdict, v.rule]), [['far', 'bl.target-pops-unpushed-frame']]);
});
