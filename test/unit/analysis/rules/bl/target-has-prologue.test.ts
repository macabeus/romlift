// bl.target-has-prologue: a far bl to a word-aligned Thumb `push {.., lr}` is a call (settle()'s
// `opensWithPrologue(rom, target)`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const T = 0x0800_0a00;
const ID = 'bl.target-has-prologue';

test('push {.., lr} on a word boundary is a call; off the boundary, or without lr, it is not', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` },
    { at: T, bytes: thumbAt(T)`push {r4, lr}; push {r4, lr}; push {r4}` },
  ]);
  const caller = readingOf(rom, { entry: F, insns: [{ addr: F, len: 2 }] });
  const v = viewWith({ rom });
  const rule = blRule(ID);
  assert.equal(rule.decide({ site: F + 2, target: T }, caller, v), 'call');
  assert.equal(rule.decide({ site: F + 2, target: T + 2 }, caller, v), undefined, 'halfword-aligned');
  assert.equal(rule.decide({ site: F + 2, target: T + 4 }, caller, v), undefined, 'no lr');
});

test('a far bl to a prologue that pops more than it pushes is a call; without the rule it reads as a far jump', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; bl _08000A00; pop {pc}` },
    { at: T, bytes: thumbAt(T)`push {lr}; pop {r0}; pop {pc}` },
  ]);
  assert.deepEqual(settle(driverOver(rom), F).blVerdicts, [{ site: F + 2, target: T, verdict: 'call', rule: ID }]);
  assert.deepEqual(
    settle(driverOver(rom, ID), F).blVerdicts.map((v) => [v.verdict, v.rule]),
    [['far', 'bl.target-pops-unpushed-frame']],
  );
});
