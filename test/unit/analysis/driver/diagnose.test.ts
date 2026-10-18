// diagnoseMisses: the PoC's diagnoseMiss at the final state of a run.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diagnoseMisses } from '../../../../src/core/analysis/driver/diagnose.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import { fakeRule, registry, romWith, testProfile, tuningFor, words } from '../../../helpers/analysis.ts';
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

test('a miss in a pool names the pool and its owner; in a region claim no function owns; valid evidence names every anchor', () => {
  const D = A + 0x40;
  const rom = romWith([
    { at: A, bytes: thumbAt(A)`ldr r0, _08000204; bx lr` },
    { at: A + 4, bytes: words(0x1234) },
    { at: A + 8, bytes: thumbAt(A + 8)`movs r0, #1; bx lr` },
    { at: A + 0x0c, bytes: thumbAt(A + 0x0c)`bx lr` },
    { at: A + 0x20, bytes: words(A + 8 + 1) },
    { at: D, bytes: words(0xffff_ffff) },
  ]);
  const region = fakeRule('region.data-after-code', { kind: 'region', classify: () => [{ span: { start: D, end: D + 4 }, kind: Claim.data, when: 'always' }] });
  const profile = testProfile({ seed: ['seed.listed'], validity: ['valid.in-rom-unclaimed', 'valid.decodes'], claim: ['claim.adjacent-pools'], region: ['region.data-after-code'], walk: walk.map((w) => w.meta.id) });
  const reg = registry(listed, inRom, decodes, extent, region, ...walk);
  const seeds = [A, A + 0x0c].map((entry) => ({ entry, mode: 'thumb' as const, rule: 'seed.listed' as const }));
  const { diagnoses } = diagnoseMisses(rom, profile, { mode: 'discover', seeds, overrides: [], trail: 'off' }, tuningFor(profile, reg), [
    { addr: A + 4, mode: 'thumb' },
    { addr: D, mode: 'thumb' },
    { addr: A + 8, mode: 'thumb' },
  ], reg);
  assert.equal(diagnoses[0]?.claim, Claim.pool);
  assert.equal(diagnoses[0]?.detail, `inside a literal pool of the accepted function at 0x08000200`);
  assert.equal(diagnoses[1]?.owner, undefined);
  assert.equal(diagnoses[1]?.detail, 'inside data no accepted function owns');
  assert.equal(diagnoses[2]?.reason, 'unanchored');
  assert.equal(diagnoses[2]?.detail, 'valid but not accepted: anchored at start, no push {.., lr}, anchored at end, 1 data word(s) point at it');
});
