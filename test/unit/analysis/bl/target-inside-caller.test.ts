// bl.target-inside-caller: a far bl to an address below the caller's code end is a jump inside the
// caller (settle()'s `target < f.codeEnd`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const T = F + 0x700;
const L = F + 0x7f0;
const ID = 'bl.target-inside-caller';

test('one byte below the code end is far; the code end itself is not', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F, insns: [{ addr: F, len: 2 }, { addr: F + 0x7fe, len: 2 }] });
  assert.equal(caller.codeEnd, F + 0x800);
  const v = viewWith({ rom });
  const rule = blRule(ID);
  assert.equal(rule.decide({ site: F + 2, target: F + 0x7ff }, caller, v), 'far');
  assert.equal(rule.decide({ site: F + 2, target: F + 0x800 }, caller, v), undefined);
});

test("a far bl into the stretch the caller's walk spans is a jump, even to a target with a prologue", () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; cmp r0, #0; beq _0800020C; bl _08000900; pop {pc}; b _080009F0` },
    { at: T, bytes: thumbAt(T)`push {r4, lr}; pop {r4, pc}` },
    { at: L, bytes: thumbAt(L)`pop {pc}` },
  ]);
  const r = settle(driverOver(rom), F);
  assert.deepEqual(r.blVerdicts, [{ site: F + 6, target: T, verdict: 'far', rule: ID }]);
  assert.equal(r.insnAt.has(T), true, 'the target is walked as part of the caller');
  assert.deepEqual(settle(driverOver(rom, ID), F).blVerdicts.map((v) => [v.verdict, v.rule]), [['call', 'bl.target-has-prologue']], 'without the rule');
});
