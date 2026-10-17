// The analysis runs under the dummy profile (g2.second-profile's helper) on a small hand-built ROM, with
// the real gap and region rules and the driver tests' stand-ins for the families other components own:
// the gap rules find the unreferenced Thumb and ARM functions, the region rules the startup region and
// the data after the code, and the region claims change no function and no extent.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES } from '../../../../src/core/analysis/driver/rules.ts';
import { runAnalysis } from '../../../../src/core/analysis/driver/run.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisOptions, RegisteredRule } from '../../../../src/core/analysis/types.ts';
import { familyOf } from '../../../../src/core/provenance/rule-id.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { BASE, registry, romWith, tuningFor } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { DUMMY_PROFILE } from '../../../helpers/dummy-profile.ts';
import { thumbAt } from '../../../helpers/thumb.ts';
import { calls, decodes, extent, inRom, romEntry, selfOrAccepted, walk } from '../driver/fakes.ts';

const CRT0 = BASE + 0xc0;
const rom = romWith(
  [
    { at: CRT0, bytes: armAt(CRT0)`stmdb sp!, {lr}; bl _08000300; ldmia sp!, {lr}; bx lr` },
    { at: BASE + 0x100, bytes: thumbAt(BASE + 0x100)`push {lr}; movs r0, #1; movs r1, #2; pop {pc}` },
    { at: BASE + 0x108, bytes: thumbAt(BASE + 0x108)`push {r4, lr}; movs r0, #0; movs r1, #0; pop {r4, pc}` },
    { at: BASE + 0x200, bytes: armAt(BASE + 0x200)`mov r0, #1; mov r1, #2; mov r2, #3; bx lr` },
    { at: BASE + 0x300, bytes: armAt(BASE + 0x300)`mov r0, #0; bx lr` },
  ],
  { entry: CRT0 },
);
const OPTIONS: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'off' };

/** The real gap and region rules, and stand-ins for the seed, walk, validity, bl and claim families. */
function rules(): ReturnType<typeof registry> {
  const own = (Object.keys(RULES) as RuleId[]).filter((id) => familyOf(id) === 'gap' || familyOf(id) === 'region').map((id) => RULES[id] as RegisteredRule);
  return registry(...own, romEntry, calls, extent, inRom, decodes, selfOrAccepted, ...walk);
}

test('the dummy profile runs: gap rules find the unreferenced functions, region rules the startup and the data', () => {
  const reg = rules();
  const result = runAnalysis(rom, DUMMY_PROFILE, OPTIONS, tuningFor(DUMMY_PROFILE, reg), reg);
  assert.equal(result.profile, 'dummy');
  assert.deepEqual(
    result.functions.map((f) => [f.entry - BASE, f.mode, f.origin, f.accepted.rule]),
    [
      [0, 'arm', 'rom-entry', 'seed.rom-entry'],
      [0xc0, 'arm', 'rom-entry', 'seed.rom-entry'],
      [0x100, 'thumb', 'gap-scan', 'gap.forward-chain'],
      [0x108, 'thumb', 'gap-scan', 'gap.forward-chain'],
      [0x200, 'arm', 'arm-gap-scan', 'gap.arm-scan'],
      [0x300, 'arm', 'call', 'seed.call'],
    ],
  );
  assert.deepEqual(result.startup, { span: { start: BASE, end: CRT0 + 0x10 }, entries: [BASE, CRT0] });
  assert.equal(result.codeEnd, BASE + 0x308);
  assert.deepEqual(result.claims.at(-1), { span: { start: BASE + 0x308, end: rom.end }, kind: Claim.data });
});

test('the region claims change no function and no extent', () => {
  const reg = rules();
  const regions = DUMMY_PROFILE.pipeline.region;
  const withRegions = runAnalysis(rom, DUMMY_PROFILE, OPTIONS, tuningFor(DUMMY_PROFILE, reg), reg);
  const without = runAnalysis(rom, DUMMY_PROFILE, OPTIONS, tuningFor(DUMMY_PROFILE, reg, { disabled: regions }), reg);
  assert.deepEqual(withRegions.functions, without.functions);
  assert.ok(withRegions.claims.some((c) => c.kind === Claim.data));
  assert.ok(!without.claims.some((c) => c.kind === Claim.data || c.kind === Claim.padding));
  assert.deepEqual(
    withRegions.claims.filter((c) => c.kind !== Claim.data && c.kind !== Claim.padding),
    without.claims,
  );
});
