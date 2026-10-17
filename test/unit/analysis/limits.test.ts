import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AnalysisCodes } from '../../../src/core/analysis/codes.ts';
import { candidateBudget, fixpointLimit, LIMITS, settleLimit, walkLimit } from '../../../src/core/analysis/limits.ts';
import { romWith, viewWith, walkReading, words } from '../../helpers/analysis.ts';

test("the limits are the PoC's settle cap and four safety bounds", () => {
  assert.equal(LIMITS.settleRounds, 600);
  assert.ok(LIMITS.fixpointRounds > 0);
  assert.ok(LIMITS.candidateBudget > 0);
  assert.ok(LIMITS.walkInsns >= 65_536, 'five times the largest function of the tuning ROMs');
  assert.equal(LIMITS.zeroRun, 64);
});

test('each limit raises a warning, never an error', () => {
  const s = settleLimit(0x0800_0100, 600);
  assert.equal(s.code, 'W_SETTLE_LIMIT');
  assert.equal(s.severity, 'warning');
  assert.equal(s.addr, 0x0800_0100);
  assert.match(s.message, /0x08000100.*600 rounds/);
  assert.equal(fixpointLimit('grow', 10).code, 'W_FIXPOINT_LIMIT');
  assert.equal(candidateBudget(3, 9, 8).code, 'W_CANDIDATE_BUDGET');
  assert.equal(walkLimit(0x0800_0100, 'thumb', 0x0802_0100).code, 'W_WALK_LIMIT');
  for (const code of ['W_SETTLE_LIMIT', 'W_FIXPOINT_LIMIT', 'W_CANDIDATE_BUDGET', 'W_WALK_LIMIT'] as const) assert.equal(AnalysisCodes[code].severity, 'warning');
});

test('a path over more than zeroRun zero halfwords stops with a zero-run error; a walk stops with a walk-limit error at walkInsns', () => {
  const F = 0x0800_0200;
  const zeros = walkReading(viewWith({ rom: romWith([], { size: 0x1000 }) }), F, 'thumb');
  assert.deepEqual(zeros.errors, [{ reason: 'zero-run', at: F + 2 * (LIMITS.zeroRun + 1) - 2 }]);
  assert.equal(zeros.insns.length, LIMITS.zeroRun);
  // 0x0032 (lsls r2, r6, #0) over 2 * walkInsns + 0x100 bytes: valid Thumb that never branches, never zero.
  const run = new Uint8Array(2 * LIMITS.walkInsns + 0x100);
  for (let k = 0; k < run.length; k += 2) run[k] = 0x32;
  const data = walkReading(viewWith({ rom: romWith([{ at: F, bytes: run }]) }), F, 'thumb');
  assert.deepEqual(data.errors, [{ reason: 'walk-limit', at: F + 2 * LIMITS.walkInsns }]);
  assert.equal(data.insns.length, LIMITS.walkInsns);
  const arm = walkReading(viewWith({ rom: romWith([{ at: F, bytes: words(0xe3a00001) }], { size: 0x1000 }) }), F, 'arm');
  assert.deepEqual(arm.errors, [{ reason: 'zero-run', at: F + 4 * (LIMITS.zeroRun + 1) }]);
});
