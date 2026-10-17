import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { doctorReal, toolchainChecks } from '../../../bench/src/doctor-real.ts';
import { benchRun } from '../../../bench/src/run.ts';
import { apiResults } from '../../../bench/src/serve.ts';
import { withTempDir } from './fixtures.ts';
import { syntheticTier, TINY_DEPS } from './harness.ts';

test('toolchainChecks names a missing tool and a version that differs from the artifact', () => {
  const found = { as: 'as 2', ld: null, objcopy: 'objcopy 1' };
  const checks = toolchainChecks(found, { as: 'as 1', ld: 'ld 1', objcopy: 'objcopy 1' });
  assert.deepEqual(checks.map((c) => [c.id, c.ok]), [['toolchain.as', false], ['toolchain.ld', false], ['toolchain.objcopy', true]]);
  assert.match(checks[0]?.detail ?? '', /'as 2', results\.json records 'as 1'/);
  assert.match(checks[1]?.detail ?? '', /arm-none-eabi-ld is missing/);
  assert.ok(toolchainChecks(found, undefined)[0]?.ok);
});

test('doctor-real checks each ROM, ELF and map and the PoC checkout, and names what is wrong', async () => {
  await withTempDir('romlift-doctor-', async (root) => {
    const cx = await syntheticTier(root);
    const inputs = (await doctorReal(cx)).checks.filter((c) => !c.id.startsWith('toolchain.'));
    assert.deepEqual(inputs.map((c) => [c.id, c.ok]), [['tiny.rom', true], ['tiny.elf', true], ['tiny.map', true], ['poc', true]]);
    await writeFile(join(cx.benchRoot, 'tiny', 'tiny.gba'), 'changed');
    await rm(join(cx.benchRoot, 'tiny', 'tiny.map'));
    await writeFile(join(cx.pocRoot, 'package-lock.json'), '{}');
    const report = await doctorReal(cx);
    assert.equal(report.ok, false);
    const failed = report.checks.filter((c) => !c.ok && !c.id.startsWith('toolchain.'));
    assert.deepEqual(failed.map((c) => c.id), ['tiny.rom', 'tiny.map', 'poc']);
    assert.match(failed[0]?.detail ?? '', /has sha1 [0-9a-f]{40}, recorded/);
    assert.match(failed[2]?.detail ?? '', /package-lock\.json is not in the pinned PoC source/);
  });
});

test('the web report endpoint serves the artifact, its base, the verdict and the vocabularies', async () => {
  await withTempDir('romlift-web-', async (root) => {
    const cx = await syntheticTier(root);
    assert.equal((await apiResults(cx, join(root, 'none.json'))).status, 404);
    await benchRun(cx, { runner: TINY_DEPS.runner });
    const artifact = join(cx.repoRoot, 'bench', 'results.json');
    const { status, body } = await apiResults(cx, artifact);
    assert.equal(status, 200);
    const b = body as { results: { roms: unknown[] }; base: { ref: string }; gate: string[]; diff: unknown[]; datasets: unknown[]; vocab: Record<string, object> };
    assert.equal(b.results.roms.length, 1);
    assert.equal(b.base.ref, artifact);
    assert.equal(b.gate.length, 1);
    assert.equal(b.diff.length, 1);
    assert.equal(b.datasets.length, 1);
    assert.deepEqual(Object.keys(b.vocab), ['missReasons', 'origins', 'categories']);
  });
});
