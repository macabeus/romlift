// The gap rules at the driver's call sites (fillGaps) under agbcc: where the forward chain stops at data,
// the end anchor takes the readings that end at the gap's end one by one, shrinking it, and the backward
// chain takes the two-instruction prologue stub below them that the end anchor's minimum size rejects.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../../src/core/analysis/driver/rules.ts';
import { runAnalysis } from '../../../../../src/core/analysis/driver/run.ts';
import type { RegisteredRule } from '../../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../../src/core/profile/agbcc.ts';
import { familyOf } from '../../../../../src/core/provenance/rule-id.ts';
import type { RuleId } from '../../../../../src/core/provenance/rule-id.ts';
import { BASE, registry, romWith, tuningFor, words } from '../../../../helpers/analysis.ts';
import { armAt } from '../../../../helpers/arm.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';
import { calls, decodes, extent, inRom, romEntry, selfOrAccepted, walk } from '../../driver/fakes.ts';

const CRT0 = BASE + 0xc0;

test('end anchor, then backward chain, below an accepted function after data', () => {
  const rom = romWith(
    [
      { at: CRT0, bytes: armAt(CRT0)`stmdb sp!, {lr}; bl _08000300; ldmia sp!, {lr}; bx lr` },
      { at: BASE + 0xd0, bytes: words(0xffff_ffff) },
      { at: BASE + 0x2e8, bytes: thumbAt(BASE + 0x2e8)`push {lr}; pop {pc}` },
      { at: BASE + 0x2ec, bytes: thumbAt(BASE + 0x2ec)`push {lr}; movs r0, #0; movs r0, #0; pop {pc}` },
      {
        at: BASE + 0x2f4,
        bytes: thumbAt(BASE + 0x2f4)`push {lr}; movs r1, #1; movs r1, #1; movs r1, #1; movs r1, #1; pop {pc}`,
      },
      { at: BASE + 0x300, bytes: armAt(BASE + 0x300)`mov r0, #0; bx lr` },
    ],
    { entry: CRT0 },
  );
  const own = (Object.keys(RULES) as RuleId[])
    .filter((id) => familyOf(id) === 'gap' || familyOf(id) === 'region')
    .map((id) => RULES[id] as RegisteredRule);
  const reg = registry(...own, romEntry, calls, extent, inRom, decodes, selfOrAccepted, ...walk);
  const result = runAnalysis(
    rom,
    AGBCC,
    { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    tuningFor(AGBCC, reg),
    reg,
  );
  const found = result.functions
    .filter((f) => f.entry >= BASE + 0x100 && f.entry < BASE + 0x300)
    .map((f) => [f.entry - BASE, f.accepted.rule, f.extent.end - BASE]);
  assert.deepEqual(found, [
    [0x2e8, 'gap.backward-prologue-chain', 0x2ec],
    [0x2ec, 'gap.end-anchor', 0x2f4],
    [0x2f4, 'gap.end-anchor', 0x300],
  ]);
});
