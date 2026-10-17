// bl.target-beyond-callee: a far bl whose target lies beyond the entry of another function the caller calls
// (accepted, or a bl target that opens with a prologue) is a call; a far target before every such entry is
// left to the rules below it. The pops-unpushed-frame fixture's DropArg, settled before it is accepted.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const P = 0x0800_0a00; // a function with a prologue the caller calls
const D = 0x0800_0a08; // past it: pops a word it never pushed, no prologue
const ID = 'bl.target-beyond-callee';

test('a target past a prologue the caller also calls is a call; one before it, or the caller entry, is not', () => {
  const rom = romWith([{ at: P, bytes: thumbAt(P)`push {lr}; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F, blSites: [{ site: F + 4, target: P }, { site: F + 8, target: D }] });
  const v = viewWith({ rom });
  const rule = blRule(ID);
  assert.equal(rule.decide({ site: F + 8, target: D }, caller, v), 'call');
  assert.equal(rule.decide({ site: F + 4, target: P }, caller, v), undefined, 'the site itself is no boundary for its own target');
  assert.equal(rule.decide({ site: F + 0x0c, target: P - 8 }, caller, v), undefined, 'before the boundary: may be the caller tail');
  const noPrologue = readingOf(rom, { entry: F, blSites: [{ site: F + 4, target: P + 2 }, { site: F + 8, target: D }] });
  assert.equal(rule.decide({ site: F + 8, target: D }, noPrologue, v), undefined, 'P + 2 is no function start');
});

test('an accepted function the caller calls is a boundary too', () => {
  const rom = romWith([]);
  const caller = readingOf(rom, { entry: F, blSites: [{ site: F + 4, target: P + 2 }, { site: F + 8, target: D }] });
  const v = viewWith({ rom, functions: [P + 2] });
  assert.equal(blRule(ID).decide({ site: F + 8, target: D }, caller, v), 'call');
});

test('settled before its callee is accepted, a far bl past a called prologue is a call; without the rule it is a far jump', () => {
  const caller = thumbAt(F)`push {r4, lr}; push {r0}; bl _08000A00; push {r0}; bl _08000A08; pop {r4}; pop {r0}; bx r0`;
  const rom = romWith([
    { at: F, bytes: caller },
    { at: P, bytes: thumbAt(P)`push {lr}; movs r0, #0; pop {r3}; add sp, #4; bx r3` },
    { at: D, bytes: thumbAt(D)`add sp, #4; bx lr` },
  ]);
  const site = F + 0x0a;
  const verdict = (r: ReturnType<typeof settle>): unknown => r.blVerdicts.filter((b) => b.site === site).map((b) => [b.verdict, b.rule]);
  assert.deepEqual(verdict(settle(driverOver(rom), F)), [['call', ID]]);
  assert.deepEqual(verdict(settle(driverOver(rom, ID), F)), [['far', 'bl.target-pops-unpushed-frame']]);
});
