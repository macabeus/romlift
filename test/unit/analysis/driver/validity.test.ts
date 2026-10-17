// valid(): the optimistic memo, intrinsic failures kept for the analysis, 'calls-non-code' kept for the
// epoch only, and validity rules that judge the entry before any reading.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDriver } from '../../../../src/core/analysis/driver/run.ts';
import { valid, whyInvalid } from '../../../../src/core/analysis/driver/validity.ts';
import { beginEpoch } from '../../../../src/core/analysis/driver/epoch.ts';
import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import { settle } from '../../../../src/core/analysis/driver/settle.ts';
import type { RegisteredRule } from '../../../../src/core/analysis/types.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { decodes, extent, failing, inRom, walk } from './fakes.ts';
import { recorder } from './recorder.ts';

const F = 0x0800_0200;
const G = 0x0800_0240;

function driver(rules: readonly RegisteredRule[], oracle = recorder()) {
  const rom = romWith([
    { at: F, bytes: thumbAt(F)`push {lr}; bl _08000240; pop {pc}` },
    { at: G, bytes: thumbAt(G)`push {lr}; bl _08000200; pop {pc}` },
  ]);
  const profile = testProfile({ validity: rules.map((r) => r.meta.id), claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(...rules, extent, ...walk);
  return { s: createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, reg, { oracle }), reg), oracle };
}

test('the memo is optimistic while the callees are checked, so mutual recursion terminates', () => {
  const seen: boolean[] = [];
  const callsCode = fakeRule('valid.calls-code', {
    kind: 'valid',
    reason: 'calls-non-code',
    intrinsic: false,
    check: (r, v) => {
      for (const c of r.calls) seen.push(v.valid(c.target), v.valid(r.entry));
      return undefined;
    },
  });
  const { s } = driver([inRom, decodes, callsCode]);
  assert.equal(valid(s, F), true);
  assert.deepEqual(seen, [true, true, true, true], 'G sees F optimistically valid, and F itself while it is checked');
  assert.equal(s.validMemo.get(F), true);
  assert.equal(s.validMemo.get(G), true);
});

test('an intrinsic failure is kept across epochs; a calls-non-code failure only for its epoch', () => {
  let checks = 0;
  const { s } = driver([inRom, decodes, failing('valid.calls-code', 'calls-non-code', false, () => (checks += 1))]);
  assert.equal(valid(s, F), false);
  assert.equal(valid(s, F), false);
  assert.equal(checks, 1, 'memoised in the epoch');
  assert.equal(s.neverValid.has(F), false);
  beginEpoch(s);
  assert.equal(valid(s, F), false);
  assert.equal(checks, 2, 're-checked in the next epoch');
  const rejection = [...s.rejections.values()].find((r) => r.at === F);
  assert.equal(rejection?.count, 2);
  assert.equal(rejection?.reason, 'calls-non-code');
  assert.equal(rejection?.intrinsic, false);

  const intrinsic = driver([inRom, decodes, failing('valid.dense', 'not-dense', true)]).s;
  assert.equal(valid(intrinsic, F), false);
  assert.equal(intrinsic.neverValid.has(F), true);
  beginEpoch(intrinsic);
  assert.equal(intrinsic.view.neverValid(F), true);
});

test('an entry outside the ROM, odd or claimed is never valid and asks no reading; a function is always valid', () => {
  const { s, oracle } = driver([inRom, decodes]);
  assert.equal(valid(s, F + 1), false);
  assert.equal(s.neverValid.has(F + 1), true);
  assert.equal(oracle.log.includes('settle'), false);
  assert.deepEqual(whyInvalid(s, 0x0900_0000), { rule: 'valid.in-rom-unclaimed', reason: 'inside-code', intrinsic: true, detail: 'outside the ROM' });
  assert.equal(oracle.log.includes('settle'), false, 'checkEntry needs no reading');
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  assert.equal(valid(s, F), true);
  assert.equal(whyInvalid(s, F + 2)?.detail, 'inside claimed bytes');
});

test('the epoch drops readings of entries not accepted and the memo, and keeps accepted readings', () => {
  const { s } = driver([inRom, decodes]);
  settle(s, F);
  settle(s, G);
  valid(s, G);
  accept(s, { entry: F, mode: 'thumb', proposedBy: 'seed.call', cites: [] });
  assert.equal(s.settled.has(G), true);
  beginEpoch(s);
  assert.equal(s.settled.has(F), true);
  assert.equal(s.settled.has(G), false);
  assert.equal(s.validMemo.size, 0);
});
