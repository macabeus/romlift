// bl.self-or-accepted: a bl to the caller itself or to an accepted function is a call (settle()'s first
// clause).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accept } from '../../../../../src/core/analysis/driver/accept.ts';
import { settle } from '../../../../../src/core/analysis/driver/settle.ts';
import { readingOf, romWith, viewWith } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { blRule, driverOver } from './support.ts';

const F = 0x0800_0200;
const G = 0x0800_0a00;
const ID = 'bl.self-or-accepted';

test('the entry itself and an accepted function are calls; anything else is left to the ladder', () => {
  const rom = romWith([{ at: F, bytes: thumbAt(F)`push {lr}; bl _08000200; pop {pc}` }]);
  const caller = readingOf(rom, { entry: F });
  const rule = blRule(ID);
  assert.equal(rule.decide({ site: F + 2, target: F }, caller, viewWith({ rom })), 'call');
  assert.equal(rule.decide({ site: F + 2, target: G }, caller, viewWith({ rom, functions: [G] })), 'call');
  assert.equal(rule.decide({ site: F + 2, target: G }, caller, viewWith({ rom })), undefined);
  assert.equal(
    rule.decide({ site: F + 2, target: F + 2 }, caller, viewWith({ rom })),
    undefined,
    'the entry, not any address of the caller',
  );
});

test('a far bl to an accepted function that pops a frame it never pushed is still a call', () => {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; bl _08000A00; pop {pc}` },
    { at: G, bytes: thumbAt(G)`pop {pc}` },
  ]);
  const s = driverOver(rom);
  accept(s, { entry: G, mode: 'thumb', proposedBy: 'seed.listed', cites: [] });
  assert.deepEqual(settle(s, F).blVerdicts, [{ site: F + 2, target: G, verdict: 'call', rule: ID }]);
  const fresh = driverOver(rom);
  assert.deepEqual(
    settle(fresh, F).blVerdicts.map((v) => [v.verdict, v.rule]),
    [['far', 'bl.target-pops-unpushed-frame']],
    'unknown, the same bl is a far jump',
  );
});
