// The canonical pass (driver/canonical.ts, D114): on every synthetic fixture, in both modes, the selective re-read
// gives exactly the analysis the full re-read ('canonicalSweep: full') gives, and the confirm run seeded with the
// discover run's functions (labels as init writes them) gives the discover run's functions, extents, far verdicts
// and claims.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { canonicalJson, profileById, romFromBytes, type AnalysisOptions, type AnalysisResult, type JsonValue, type Seed } from 'romlift';
import { analyzeTuned, DEFAULT_TUNING } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import { listSyntheticFixtures } from '../../../helpers/fixtures.ts';

const digest = (r: AnalysisResult): string => Array.from(canonicalJson(r as unknown as JsonValue)).join('');

/** The listed set init writes: every found entry and mode, `label` when it lies strictly inside an earlier extent. */
function listed(r: AnalysisResult): Seed[] {
  let reach = -Infinity;
  return [...r.functions]
    .sort((a, b) => a.entry - b.entry)
    .map((f) => {
      const label = f.entry < reach;
      reach = Math.max(reach, f.extent.end);
      return label ? { entry: f.entry, mode: f.mode, rule: 'seed.listed', label: true } : { entry: f.entry, mode: f.mode, rule: 'seed.listed' };
    });
}

/** What g2.confirm-equals-discover compares. */
function parity(r: AnalysisResult): string {
  return JSON.stringify([
    r.functions.map((f) => [f.entry, f.mode, f.extent.start, f.extent.end, f.blVerdicts.filter((v) => v.verdict === 'far').map((v) => [v.site, v.target])]),
    r.claims.map((c) => [c.span.start, c.span.end, c.kind, c.owner ?? null]),
  ]);
}

const profile = profileById('agbcc');

test('the selective re-read gives the full re-read on every synthetic fixture, in both modes', () => {
  assert.ok(profile !== undefined);
  const fixtures = listSyntheticFixtures();
  assert.ok(fixtures.length > 0);
  for (const f of fixtures) {
    const bytes = new Uint8Array(readFileSync(f.rom));
    const rom = romFromBytes(bytes, sha1Of(bytes));
    const discover: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'off' };
    const found = analyzeTuned(rom, profile, discover, DEFAULT_TUNING);
    assert.equal(digest(found), digest(analyzeTuned(rom, profile, discover, { ...DEFAULT_TUNING, canonicalSweep: 'full' })), `${f.name}: discover`);
    const confirm: AnalysisOptions = { mode: 'confirm', seeds: listed(found), overrides: [], trail: 'off' };
    assert.equal(digest(analyzeTuned(rom, profile, confirm, DEFAULT_TUNING)), digest(analyzeTuned(rom, profile, confirm, { ...DEFAULT_TUNING, canonicalSweep: 'full' })), `${f.name}: confirm`);
  }
});

test('the confirm run of the listed set gives the discover run on every synthetic fixture', () => {
  assert.ok(profile !== undefined);
  for (const f of listSyntheticFixtures()) {
    const bytes = new Uint8Array(readFileSync(f.rom));
    const rom = romFromBytes(bytes, sha1Of(bytes));
    const found = analyzeTuned(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, DEFAULT_TUNING);
    const confirmed = analyzeTuned(rom, profile, { mode: 'confirm', seeds: listed(found), overrides: [], trail: 'off' }, DEFAULT_TUNING);
    assert.equal(parity(confirmed), parity(found), f.name);
  }
});
