// bl.noreturn-before-noncode: a refinement: a call or deferred site in the caller's dead ends never
// returns (settle()'s `f.deadEnd.has(site)`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const T = 0x0800_0280;
const ID = 'bl.noreturn-before-noncode';
const INVALID = Uint8Array.from([0x00, 0xb1]);

test('a refinement: a site in the dead ends never returns; any other site is left alone', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F, deadEnd: [F + 2, F + 0x10, F + 0x20] });
  const rule = blRule(ID);
  assert.equal(rule.refines, true);
  const v = viewWith({ rom });
  for (const site of [F + 2, F + 0x10, F + 0x20]) assert.equal(rule.decide({ site, target: T }, caller, v), 'noreturn');
  for (const site of [F, F + 4, F + 0x12, F + 0x22])
    assert.equal(rule.decide({ site, target: T }, caller, v), undefined);
  assert.equal(rule.decide({ site: F + 2, target: T }, readingOf(rom, { entry: F }), v), undefined, 'no dead ends');
});

test('through settle: the call keeps its verdict rule and is refined to noreturn; nothing after it is walked', () => {
  const rom = romWith([
    { at: F, bytes: Uint8Array.from([...thumbAt(F)`push {lr}; bl _08000280`, ...INVALID]) },
    { at: T, bytes: thumbAt(T)`b _08000280` },
  ]);
  const r = settle(driverOver(rom), F);
  assert.deepEqual(r.noret, [F + 2]);
  assert.deepEqual(r.blVerdicts, [{ site: F + 2, target: T, verdict: 'noreturn', rule: ID }]);
  assert.deepEqual(
    r.exits.map((e) => [e.at, e.kind, e.rule]),
    [[F + 2, 'noreturn-call', ID]],
  );
  assert.deepEqual(r.errors, []);
  const bare = settle(driverOver(rom, ID), F);
  assert.deepEqual(bare.noret, []);
  assert.deepEqual(
    bare.blVerdicts.map((v) => [v.verdict, v.rule]),
    [['call', 'bl.near-is-call']],
  );
  assert.deepEqual(bare.deadEnd, [F + 2], 'the walk rule still marks the dead end');
});

test('a far jump is never refined', () => {
  const rom = romWith([
    { at: F, bytes: Uint8Array.from([...thumbAt(F)`push {lr}; bl _08000A00`, ...INVALID]) },
    { at: 0x0800_0a00, bytes: thumbAt(0x0800_0a00)`pop {pc}` },
  ]);
  const r = settle(driverOver(rom), F);
  assert.deepEqual(r.noret, []);
  assert.deepEqual(r.far, [F + 2]);
});
