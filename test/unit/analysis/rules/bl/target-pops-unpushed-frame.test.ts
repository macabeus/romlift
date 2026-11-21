// bl.target-pops-unpushed-frame: settle()'s last clause: the target read alone pops a frame it never
// pushed → far; otherwise call; a target being settled up the stack → defer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const T = 0x0800_0a00;
const ID = 'bl.target-pops-unpushed-frame';

test('the balance of the target decides: +4 is far, 0 is a call; a target in progress is deferred', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F });
  const rule = blRule(ID);
  const pops = viewWith({ rom, readings: [readingOf(rom, { entry: T, balance: [0, 4] })] });
  assert.equal(rule.decide({ site: F + 2, target: T }, caller, pops), 'far');
  const balanced = viewWith({ rom, readings: [readingOf(rom, { entry: T, balance: [0, -4] })] });
  assert.equal(rule.decide({ site: F + 2, target: T }, caller, balanced), 'call');
  const busy = { ...pops, inProgress: (a: number) => a === T };
  assert.equal(rule.decide({ site: F + 2, target: T }, caller, busy), 'defer');
});

test("through settle: a far tail that pops the caller's frame joins the caller; a plain function stays a call", () => {
  const tail = romWith([
    { at: F, bytes: thumbAt(F)`push {r4, lr}; bl _08000A02; pop {pc}` },
    { at: T + 2, bytes: thumbAt(T + 2)`movs r0, #0; pop {r4, pc}` },
  ]);
  const r = settle(driverOver(tail), F);
  assert.deepEqual(r.blVerdicts, [{ site: F + 2, target: T + 2, verdict: 'far', rule: ID }]);
  assert.deepEqual(r.far, [F + 2]);
  assert.deepEqual(r.calls, []);
  assert.equal(r.insnAt.has(T + 4), true);
  const plain = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; bl _08000A02; pop {pc}` },
    { at: T + 2, bytes: thumbAt(T + 2)`movs r0, #0; bx lr` },
  ]);
  assert.deepEqual(
    settle(driverOver(plain), F).blVerdicts.map((v) => [v.verdict, v.rule]),
    [['call', ID]],
  );
});

test('mutual far bls: the inner settle defers on the entry in progress, and both settle without a limit warning', () => {
  // Under agbcc's order every entry up the stack lies below the one being settled, so
  // bl.target-before-entry answers first; with it and bl.target-inside-caller left out the deferral shows.
  const G = T + 2;
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`movs r0, #0; bl _08000A02; bx lr` },
    { at: G, bytes: thumbAt(G)`movs r0, #1; bl _08000200; bx lr` },
  ]);
  const s = driverOver(rom, 'bl.target-before-entry', 'bl.target-inside-caller');
  const r = settle(s, F);
  assert.deepEqual(
    r.blVerdicts.map((v) => [v.site, v.verdict, v.rule]),
    [[F + 2, 'call', ID]],
  );
  assert.deepEqual(
    s.settled.get(G)?.blVerdicts.map((v) => [v.verdict, v.rule]),
    [['call', ID]],
    'the deferred site is recorded as a call',
  );
  assert.equal(s.inProgress.size, 0);
  assert.deepEqual(s.diagnostics, []);
});
