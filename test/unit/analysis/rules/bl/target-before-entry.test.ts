// bl.target-before-entry: a bl to an address below the caller's entry is a call (settle()'s `target <
// entry`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const E = 0x0800_0200;
const F = 0x0800_1000;
const ID = 'bl.target-before-entry';

test('one byte below the entry is a call; the entry and above are left to the ladder', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F });
  const v = viewWith({ rom });
  const rule = blRule(ID);
  assert.equal(rule.decide({ site: F + 2, target: F - 2 }, caller, v), 'call');
  assert.equal(rule.decide({ site: F + 2, target: F - 1 }, caller, v), 'call');
  assert.equal(rule.decide({ site: F + 2, target: F }, caller, v), undefined);
  assert.equal(rule.decide({ site: F + 2, target: F + 0x800 }, caller, v), undefined);
});

test('a far backward bl to code that pops an unpushed frame is a call; without the rule it reads as a far jump', () => {
  const rom = romWith([
    { at: E, bytes: thumbAt(E)`pop {pc}` },
    { at: F, bytes: thumbAt(F)`push {lr}; bl _08000200; pop {pc}` },
  ]);
  assert.deepEqual(settle(driverOver(rom), F).blVerdicts, [{ site: F + 2, target: E, verdict: 'call', rule: ID }]);
  const bare = settle(driverOver(rom, ID), F);
  assert.deepEqual(
    bare.blVerdicts.map((v) => [v.verdict, v.rule]),
    [['far', 'bl.target-inside-caller']],
  );
  assert.equal(bare.insnAt.has(E), true);
});
