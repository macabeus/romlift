// The phase-2/3 seam (roadmap "Phase 3", D19, D62): the canonical analysis of every committed fixture,
// the seedless discover run under profileById('agbcc') encoded by encodeAnalysis, one
// test/golden/analysis/<fixture>.json each. The model, printer and write-plan work of phase 3 builds on
// these files before buildModel exists, and a rule change shows up here as a diff. UPDATE_GOLDEN=1
// rewrites them and removes a file no fixture produces; the diff is the review.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeAnalysis, encodeAnalysis } from '../../../src/core/analysis/codec.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FIXTURES = listSyntheticFixtures();

/** The golden text of one fixture: its canonical analysis and a newline. */
function analysisText(rom: Parameters<typeof discover>[0]): string {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  return `${[...encodeAnalysis(discover(rom, { profile }))].join('')}\n`;
}

test('every committed fixture has an analysis golden', () => {
  assert.ok(FIXTURES.length >= 47, `${FIXTURES.length} fixtures`);
});

for (const fixture of FIXTURES) {
  test(`analysis golden ${fixture.name}`, () => {
    const actual = analysisText(readFixtureRom(fixture));
    const file = join(DIR, `${fixture.name}.json`);
    if (UPDATE) writeFileSync(file, actual);
    const golden = readFileSync(file, 'utf8');
    assert.equal(actual, golden, `${fixture.name}.json differs; UPDATE_GOLDEN=1 rewrites it`);
    const decoded = decodeAnalysis(golden);
    assert.ok(decoded.ok, `${fixture.name}.json does not decode`);
    assert.equal(decoded.result.mode, 'discover');
    assert.equal(decoded.result.profile, 'agbcc');
    assert.deepEqual(decoded.result.options.seeds, []);
  });
}

test('every analysis golden belongs to a fixture', () => {
  const names = new Set(FIXTURES.map((f) => `${f.name}.json`));
  const stale: string[] = [];
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.json') || names.has(file)) continue;
    if (UPDATE) rmSync(join(DIR, file));
    else stale.push(file);
  }
  assert.deepEqual(stale, []);
});
