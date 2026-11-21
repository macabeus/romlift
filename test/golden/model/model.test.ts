// Golden models (architecture §3.4, D19, D62): for every committed fixture, the NDJSON encodeModel prints
// for the seedless discover run under profileById('agbcc'), the config configFromDiscover builds from it and
// buildModel; one test/golden/model/<fixture>.ndjson each. A change to the model, the analysis or the printing
// rule shows up here as a diff. UPDATE_GOLDEN=1 rewrites them and removes a file no fixture produces.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeModel } from '../../../src/core/model/codec.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FIXTURES = listSyntheticFixtures();

/** The golden text of one fixture: the model's NDJSON. */
function modelText(rom: Parameters<typeof discover>[0]): string {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  const analysis = discover(rom, { profile });
  return [...encodeModel(buildModel(rom, analysis, configFromDiscover(rom, analysis)), rom)].join('');
}

test('every committed fixture has a model golden', () => {
  assert.ok(FIXTURES.length >= 47, `${FIXTURES.length} fixtures`);
});

for (const fixture of FIXTURES) {
  test(`model golden ${fixture.name}`, () => {
    const actual = modelText(readFixtureRom(fixture));
    const file = join(DIR, `${fixture.name}.ndjson`);
    if (UPDATE) writeFileSync(file, actual);
    assert.equal(actual, readFileSync(file, 'utf8'), `${fixture.name}.ndjson differs; UPDATE_GOLDEN=1 rewrites it`);
  });
}

test('every model golden belongs to a fixture', () => {
  const names = new Set(FIXTURES.map((f) => `${f.name}.ndjson`));
  const stale: string[] = [];
  for (const file of readdirSync(DIR)) {
    if (!file.endsWith('.ndjson') || names.has(file)) continue;
    if (UPDATE) rmSync(join(DIR, file));
    else stale.push(file);
  }
  assert.deepEqual(stale, []);
});
