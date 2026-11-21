// bench/src/doctor-real.ts on the synthetic real tier: each ROM, ELF and map, the reference objects (their
// digest, and the objects the map links), the PoC checkout, the binutils against the artifact, and
// objdiff-cli against bench/tools/objdiff.version; every missing or mismatching input is named.
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BenchContext } from '../../../bench/src/context.ts';
import { doctorReal, objdiffCheck, toolchainChecks } from '../../../bench/src/doctor-real.ts';
import { objectsDigest } from '../../../bench/src/objects.ts';
import { withTempDir } from './fixtures.ts';
import { syntheticTier } from './harness.ts';

const REFERENCE_O = new URL('../../fixtures/objdiff/reference.o', import.meta.url);
const PINNED = 'objdiff-cli 3.7.2';

/** A map that links `ref/reference.o` (its .text is 0x2c bytes, its .rodata 4) and one libgcc member. */
const MAP = [
  'Linker script and memory map',
  '',
  '.text           0x08000000       0x34',
  ' .text          0x08000000       0x2c ref/reference.o',
  ' .text          0x0800002c        0x8 lib/libgcc.a(_divsi3.o)',
  '',
  '.rodata         0x08000034        0x4',
  ' .rodata        0x08000034        0x4 ref/reference.o',
  '',
].join('\n');

/** The synthetic tier with tiny's objects under `tiny/build`, its map linking them, the pin, and a stub objdiff-cli. */
async function tierWithObjects(root: string): Promise<{ cx: BenchContext; stub: string }> {
  const cx = await syntheticTier(root);
  const objects = join(cx.benchRoot, 'tiny', 'build');
  await mkdir(join(objects, 'ref'), { recursive: true });
  await copyFile(REFERENCE_O, join(objects, 'ref', 'reference.o'));
  await writeFile(join(objects, 'unlinked.o'), 'built, not linked: still in the digest');
  await writeFile(join(cx.benchRoot, 'tiny', 'tiny.map'), MAP);
  const file = join(cx.repoRoot, 'bench', 'dataset', 'real', 'tiny.json');
  const dataset = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  await writeFile(
    file,
    JSON.stringify({ ...dataset, objectsDir: 'tiny/build', objectsDigest: await objectsDigest(objects) }),
  );
  await mkdir(join(cx.repoRoot, 'bench', 'tools'), { recursive: true });
  await writeFile(join(cx.repoRoot, 'bench', 'tools', 'objdiff.version'), `${PINNED}\n`);
  const stub = join(root, 'objdiff-cli');
  await writeFile(stub, `#!/bin/sh\necho '${PINNED}'\n`);
  await chmod(stub, 0o755);
  return { cx, stub };
}

const inputChecks = (checks: readonly { id: string; ok: boolean }[]): [string, boolean][] =>
  checks.filter((c) => !c.id.startsWith('toolchain.') || c.id === 'toolchain.objdiff').map((c) => [c.id, c.ok]);

test('toolchainChecks names a missing tool and a version that differs from the artifact', () => {
  const found = { as: 'as 2', ld: null, objcopy: 'objcopy 1' };
  const checks = toolchainChecks(found, { as: 'as 1', ld: 'ld 1', objcopy: 'objcopy 1' });
  assert.deepEqual(
    checks.map((c) => [c.id, c.ok]),
    [
      ['toolchain.as', false],
      ['toolchain.ld', false],
      ['toolchain.objcopy', true],
    ],
  );
  assert.match(checks[0]?.detail ?? '', /'as 2', results\.json records 'as 1'/);
  assert.match(checks[1]?.detail ?? '', /arm-none-eabi-ld is missing/);
  assert.ok(toolchainChecks(found, undefined)[0]?.ok);
});

test('objdiffCheck: the pin, a missing binary named by ROMLIFT_OBJDIFF, one that does not run, another version', () => {
  const at = { bin: '/x/objdiff-cli', source: 'env' } as const;
  assert.deepEqual(objdiffCheck(at, PINNED, PINNED), {
    id: 'toolchain.objdiff',
    ok: true,
    detail: `/x/objdiff-cli ${PINNED}`,
  });
  assert.match(objdiffCheck(at, PINNED, null).detail, /bench\/tools\/objdiff\.version is missing/);
  assert.match(
    objdiffCheck(undefined, null, PINNED).detail,
    /objdiff-cli is missing: set ROMLIFT_OBJDIFF to the 'objdiff-cli 3\.7\.2' binary/,
  );
  assert.match(objdiffCheck(at, null, PINNED).detail, /\/x\/objdiff-cli \(ROMLIFT_OBJDIFF\) does not run/);
  const other = objdiffCheck({ bin: '/y/objdiff-cli', source: 'path' }, 'objdiff-cli 3.0.0-beta.11', PINNED);
  assert.equal(other.ok, false);
  assert.match(
    other.detail,
    /is 'objdiff-cli 3\.0\.0-beta\.11', bench\/tools\/objdiff\.version pins 'objdiff-cli 3\.7\.2'; set ROMLIFT_OBJDIFF/,
  );
});

test('doctor-real checks each ROM, ELF, map, objects directory, the objects the map links, the PoC and objdiff-cli', async () => {
  await withTempDir('romlift-doctor-', async (root) => {
    const { cx, stub } = await tierWithObjects(root);
    const env = { PATH: join(root, 'empty'), ROMLIFT_OBJDIFF: stub };
    const report = await doctorReal(cx, { env });
    assert.deepEqual(inputChecks(report.checks), [
      ['tiny.rom', true],
      ['tiny.elf', true],
      ['tiny.map', true],
      ['tiny.objects', true],
      ['tiny.objects-linked', true],
      ['poc', true],
      ['toolchain.objdiff', true],
    ]);
    const byId = new Map(report.checks.map((c) => [c.id, c.detail]));
    assert.match(byId.get('tiny.objects') ?? '', /tiny\/build 2 objects sha256 [0-9a-f]{64}$/);
    assert.equal(
      byId.get('tiny.objects-linked'),
      "the map's 1 objects match; 1 archive members are outside tiny/build",
    );

    await writeFile(join(cx.benchRoot, 'tiny', 'tiny.gba'), 'changed');
    await rm(join(cx.benchRoot, 'tiny', 'tiny.map'));
    await writeFile(join(cx.pocRoot, 'package-lock.json'), '{}');
    const broken = await doctorReal(cx, { env });
    assert.equal(broken.ok, false);
    const failed = broken.checks.filter((c) => !c.ok && !c.id.startsWith('toolchain.'));
    assert.deepEqual(
      failed.map((c) => c.id),
      ['tiny.rom', 'tiny.map', 'tiny.objects-linked', 'poc'],
    );
    assert.match(failed[0]?.detail ?? '', /has sha1 [0-9a-f]{40}, recorded/);
    assert.match(failed[2]?.detail ?? '', /tiny\.map is missing/);
    assert.match(failed[3]?.detail ?? '', /package-lock\.json is not in the pinned PoC source/);
  });
});

test('doctor-real names changed objects, objects that are not the linked ones, and a missing objdiff-cli', async () => {
  await withTempDir('romlift-doctor-objects-', async (root) => {
    const { cx } = await tierWithObjects(root);
    const object = join(cx.benchRoot, 'tiny', 'build', 'ref', 'reference.o');
    const bytes = new Uint8Array(await readFile(object));
    await writeFile(object, bytes.subarray(0, bytes.length - 1));
    const report = await doctorReal(cx, { env: { PATH: join(root, 'empty') } });
    const failed = report.checks.filter((c) => !c.ok && (c.id.startsWith('tiny.') || c.id === 'toolchain.objdiff'));
    assert.deepEqual(
      failed.map((c) => c.id),
      ['tiny.objects', 'tiny.objects-linked', 'toolchain.objdiff'],
    );
    assert.match(failed[0]?.detail ?? '', /\(2 objects\) has digest [0-9a-f]{64}, recorded [0-9a-f]{64}/);
    assert.match(failed[1]?.detail ?? '', /1 of the map's 1 objects are not the linked ones: ref\/reference\.o: ELF/);
    assert.match(failed[2]?.detail ?? '', /objdiff-cli is missing: set ROMLIFT_OBJDIFF/);

    await rm(object);
    const missing = await doctorReal(cx, { env: { PATH: join(root, 'empty') } });
    assert.match(
      missing.checks.find((c) => c.id === 'tiny.objects-linked')?.detail ?? '',
      /ref\/reference\.o is missing/,
    );
  });
});

test('doctor-real fails a tuning dataset that records no objects directory', async () => {
  await withTempDir('romlift-doctor-none-', async (root) => {
    const cx = await syntheticTier(root);
    const report = await doctorReal(cx, { env: { PATH: join(root, 'empty') } });
    const objects = report.checks.find((c) => c.id === 'tiny.objects');
    assert.deepEqual(objects, {
      id: 'tiny.objects',
      ok: false,
      detail: 'the dataset records no objectsDir and objectsDigest',
    });
    assert.match(
      report.checks.find((c) => c.id === 'toolchain.objdiff')?.detail ?? '',
      /bench\/tools\/objdiff\.version is missing/,
    );
  });
});
