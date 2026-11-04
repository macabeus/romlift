// The discover workflow (architecture §2.1, D36): the analysis of a bare ROM in discover mode under agbcc
// with no seeds, equal to the frozen `analyze` function call the gates make; an image that is not a cartridge gets
// E_ROM_NOT_GBA diagnostics and an empty result, never a throw; the profile, the trail and the disabled
// rules pass through.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { analyze } from '../../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../../src/core/profile/agbcc.ts';
import type { TrailEvent } from '../../../src/core/provenance/trail.ts';
import { DISCOVER_PROFILE, discover, discoverOptions } from '../../../src/core/workflow/discover.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { romWith } from '../../helpers/analysis.ts';
import { armAt } from '../../helpers/arm.ts';
import { DUMMY_PROFILE } from '../../helpers/dummy-profile.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';

const FIXTURES = listSyntheticFixtures();

function fixtureRom(name: string): ReturnType<typeof romFromBytes> {
  const fixture = FIXTURES.find((f) => f.name === name);
  assert.ok(fixture !== undefined, `fixture ${name}`);
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  return romFromBytes(bytes, sha1Of(bytes));
}

/** A hand-built cartridge: an ARM `b` to 0x080000C0, which returns. */
const HAND_BUILT = romWith([{ at: 0x0800_00c0, bytes: armAt(0x0800_00c0)`bx lr` }], { entry: 0x0800_00c0 });

test('discover options: discover mode, no seeds, no overrides, trail off unless given', () => {
  assert.deepEqual(discoverOptions(), { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
  assert.deepEqual(discoverOptions({ trail: 'full', trailFilter: { start: 0x0800_0100, end: 0x0800_0200 } }), {
    mode: 'discover',
    seeds: [],
    overrides: [],
    trail: 'full',
    trailFilter: { start: 0x0800_0100, end: 0x0800_0200 },
  });
  assert.equal(DISCOVER_PROFILE, 'agbcc');
});

test('discover equals the frozen analyze call on every committed fixture', () => {
  assert.ok(FIXTURES.length > 0);
  for (const fixture of FIXTURES) {
    const rom = fixtureRom(fixture.name);
    const expected = analyze(rom, AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
    assert.deepEqual(discover(rom), expected, fixture.name);
  }
});

test('discover on a hand-built cartridge finds its entry and records agbcc', () => {
  const result = discover(HAND_BUILT);
  assert.equal(result.mode, 'discover');
  assert.equal(result.profile, 'agbcc');
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.functions.some((f) => f.entry === 0x0800_00c0 && f.mode === 'arm'));
});

test('an image that is not a GBA cartridge gets E_ROM_NOT_GBA and an empty result, no throw', () => {
  for (const bytes of [new Uint8Array(16), new Uint8Array(0x400)]) {
    const rom = romFromBytes(bytes, sha1Of(bytes));
    const result = discover(rom);
    assert.equal(result.mode, 'discover');
    assert.deepEqual(result.functions, []);
    assert.deepEqual(result.claims, []);
    assert.deepEqual(result.rejections, []);
    assert.equal(result.codeEnd, rom.base);
    assert.deepEqual(result.rom, { sha1: rom.sha1, end: rom.end });
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every((d) => d.code === 'E_ROM_NOT_GBA' && d.severity === 'error'));
  }
});

test('a given profile is the one the analysis runs and records', () => {
  const result = discover(HAND_BUILT, { profile: DUMMY_PROFILE });
  assert.equal(result.profile, 'dummy');
  assert.deepEqual(result, analyze(HAND_BUILT, DUMMY_PROFILE, discoverOptions()));
});

test('the trail level and filter reach the sink; off streams nothing', () => {
  const rom = fixtureRom('far-jump');
  const off: TrailEvent[] = [];
  discover(rom, {}, { event: (e) => off.push(e) });
  assert.deepEqual(off, []);
  const full: TrailEvent[] = [];
  const filter = { start: 0x0800_0100, end: 0x0800_0200 };
  const result = discover(rom, { trail: 'full', trailFilter: filter }, { event: (e) => full.push(e) });
  assert.ok(full.length > 0);
  assert.deepEqual(result.options, { mode: 'discover', seeds: [], overrides: [], trail: 'full', trailFilter: filter });
  const inside = (a: number): boolean => a >= filter.start && a < filter.end;
  assert.ok(full.every((e) => inside(e.at) || e.cites.some(inside)));
});
