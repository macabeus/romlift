// bench/src/emission-run.ts: generateInto writes the tree generate checked, in stream order, with the digest of
// g3.tree-determinism, only when the check pass is clean; init is configFromDiscover then generate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { configFromDiscover, discover, generate, generatedEntries, type Rom, type RomliftConfig } from 'romlift';

import { configOf, generateInto, ROMLIFT_EMISSION } from '../../../bench/src/emission-run.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');

async function inTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-emission-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The fixture's config with its startup module renamed (sidesteps the confirm-mode startup defect). */
function renamedStartup(rom: Rom): RomliftConfig {
  const config = configFromDiscover(rom, discover(rom));
  return { ...config, modules: config.modules.map((m) => (m.name === 'crt0' ? { ...m, name: 'startup' } : m)) };
}

test('configOf is configFromDiscover over the discover analysis', () => {
  const rom = readFixtureRom(FAR_JUMP);
  // As init writes it without a signature file: the signature layer enabled (phase 6), which configFromDiscover leaves off.
  assert.deepEqual(configOf(rom), { ...configFromDiscover(rom, discover(rom)), signatures: { enabled: true } });
  assert.equal(ROMLIFT_EMISSION.prepare, configOf);
});

test('generateInto writes every file of the stream and digests it in stream order', async () => {
  const rom = readFixtureRom(FAR_JUMP);
  const config = renamedStartup(rom);
  const result = generate({ rom, config, decomp: { defined: [] }, printer: 'readable' });
  const hash = createHash('sha256');
  const texts = new Map<string, string>();
  for (const e of generatedEntries(rom, result)) {
    assert.ok('text' in e);
    hash.update(e.path).update('\0').update(e.text).update('\0');
    texts.set(e.path, e.text);
  }
  await inTemp(async (dir) => {
    const outcome = await generateInto(rom, config, dir);
    assert.equal(outcome.ok, true, outcome.detail);
    assert.equal(outcome.files, texts.size);
    assert.equal(outcome.treeDigest, hash.digest('hex'));
    for (const [path, text] of texts) assert.equal(await readFile(join(dir, path), 'utf8'), text, path);
  });
});

test('a failing check pass writes nothing and says which check failed', async () => {
  const rom = readFixtureRom(FAR_JUMP);
  const config = configOf(rom);
  const failed = generate({ rom, config, decomp: { defined: [] }, printer: 'readable' }).report.checks.find((c) => !c.ok);
  await inTemp(async (dir) => {
    const outcome = await generateInto(rom, config, dir);
    if (failed === undefined) {
      assert.equal(outcome.ok, true);
      return;
    }
    assert.equal(outcome.ok, false);
    assert.match(outcome.detail, new RegExp(`^the ${failed.id} check failed: .*; nothing written$`));
    assert.equal(outcome.treeDigest, undefined);
    const { readdirSync } = await import('node:fs');
    assert.deepEqual(readdirSync(dir), []);
  });
});
