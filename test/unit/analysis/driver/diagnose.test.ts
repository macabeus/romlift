// diagnoseMisses: the PoC's diagnoseMiss at the final state of a run.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagnoseMisses } from '../../../../src/core/analysis/driver/diagnose.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor } from '../../../helpers/analysis.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { decodes, extent, inRom, listed, walk } from './fakes.ts';

const A = 0x0800_0200;

test('inside code, an unreached ARM routine, a validity failure, or valid but unanchored', () => {
  const rom = romWith([
    { at: A, bytes: thumbAt(A)`push {lr}; movs r0, #0; pop {pc}` },
    { at: A + 0x40, bytes: Uint8Array.from([0x00, 0xb1]) },
    { at: A + 0x80, bytes: thumbAt(A + 0x80)`push {lr}; pop {pc}` },
  ]);
  const armScan = fakeRule('gap.arm-scan', { kind: 'gap', reason: 'arm-unreached', propose: () => undefined }, 'arm-gap-scan');
  const profile = testProfile({ seed: ['seed.listed'], validity: ['valid.in-rom-unclaimed', 'valid.decodes'], claim: ['claim.adjacent-pools'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(listed, inRom, decodes, extent, armScan, ...walk);
  const { result, diagnoses } = diagnoseMisses(
    rom,
    profile,
    { mode: 'discover', seeds: [{ entry: A, mode: 'thumb', rule: 'seed.listed' }], overrides: [], trail: 'off' },
    tuningFor(profile, reg),
    [
      { addr: A + 2, mode: 'thumb' },
      { addr: A + 0x100, mode: 'arm' },
      { addr: A + 0x40, mode: 'thumb' },
      { addr: A + 0x80, mode: 'thumb' },
    ],
    reg,
  );
  assert.deepEqual(result.functions.map((f) => f.entry), [A]);
  assert.deepEqual(diagnoses.map((d) => [d.reason, d.rule ?? '-']), [
    ['inside-code', 'valid.in-rom-unclaimed'],
    ['arm-unreached', 'gap.arm-scan'],
    ['decode-error', 'valid.decodes'],
    ['unanchored', '-'],
  ]);
  assert.equal(diagnoses[0]?.claim, Claim.code);
  assert.equal(diagnoses[0]?.owner, A);
  assert.match(diagnoses[3]?.detail ?? '', /^valid but not accepted: not anchored at start, has push \{\.\., lr\}, not anchored at end, nothing points at it$/);
});
