// The binutils runner: PATH lookup, E_TOOLCHAIN_MISSING, and assembling a few lines with the real
// arm-none-eabi-as (skipped as unavailable when the toolchain is not installed).
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import { assembleWithBinutils, binutilsVersions, findBinutils } from '../../../../src/shell/toolchain/binutils.ts';

const tools = findBinutils(process.env);
const available = !('code' in tools);

test('a PATH without the tools gives E_TOOLCHAIN_MISSING naming each', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'romlift-path-'));
  try {
    const result = findBinutils({ PATH: empty });
    assert.ok('code' in result);
    assert.equal(result.code, 'E_TOOLCHAIN_MISSING');
    assert.equal(result.severity, 'error');
    assert.match(result.message, /arm-none-eabi-as, arm-none-eabi-ld, arm-none-eabi-objcopy/);
    assert.ok('code' in findBinutils({}));
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('the PATH is searched in order for executables', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-path-'));
  try {
    for (const tool of ['as', 'ld', 'objcopy']) {
      const file = path.join(dir, `arm-none-eabi-${tool}`);
      await writeFile(file, '#!/bin/sh\n');
      await chmod(file, 0o755);
    }
    await writeFile(path.join(dir, 'arm-none-eabi-ld'), '');
    await chmod(path.join(dir, 'arm-none-eabi-ld'), 0o644);
    const missingLd = findBinutils({ PATH: dir });
    assert.ok('code' in missingLd && /arm-none-eabi-ld$/.test(missingLd.message));
    await chmod(path.join(dir, 'arm-none-eabi-ld'), 0o755);
    const found = findBinutils({ PATH: [path.join(dir, 'missing'), dir].join(path.delimiter) });
    assert.deepEqual(found, {
      as: path.join(dir, 'arm-none-eabi-as'),
      ld: path.join(dir, 'arm-none-eabi-ld'),
      objcopy: path.join(dir, 'arm-none-eabi-objcopy'),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('assembleWithBinutils returns the .text bytes', { skip: available ? false : 'unavailable: toolchain' }, async () => {
  const source = `${DIALECT.preamble('thumb')}\tthumb_func_start f\nf:\n\tpush {r4, lr}\n\tbx lr\n`;
  const result = await assembleWithBinutils(source, { mode: 'thumb', files: { 'include/macros.inc': DIALECT.macrosInc } });
  assert.ok(result.ok, result.ok ? '' : result.stderr);
  assert.deepEqual([...result.bytes], [0x10, 0xb5, 0x70, 0x47]);
  const arm = await assembleWithBinutils('.syntax unified\n.arm\n\tbx lr\n');
  assert.ok(arm.ok);
  assert.deepEqual([...arm.bytes], [0x1e, 0xff, 0x2f, 0xe1]);
});

test('an assembler error is returned with its stderr and E_TOOLCHAIN_FAILED', { skip: available ? false : 'unavailable: toolchain' }, async () => {
  const result = await assembleWithBinutils('.syntax unified\n.thumb\n\tmov r0, r1\n', { mode: 'thumb' });
  assert.ok(!result.ok);
  assert.match(result.stderr, /Error: MOV Rd, Rs with two low registers/);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_FAILED']);
  const escape = await assembleWithBinutils('.thumb\n', { files: { '../outside.inc': '' } });
  assert.ok(!escape.ok && /outside the assembly directory/.test(escape.diagnostics[0]?.message ?? ''));
});

test('the versions are the first lines of --version', { skip: available ? false : 'unavailable: toolchain' }, async () => {
  assert.ok(!('code' in tools));
  const versions = await binutilsVersions(tools);
  assert.match(versions.as, /^GNU assembler /);
  assert.match(versions.ld, /^GNU ld /);
  assert.match(versions.objcopy, /^GNU objcopy /);
});

test('assembleWithBinutils without the tools gives E_TOOLCHAIN_MISSING', async () => {
  const saved = process.env['PATH'];
  process.env['PATH'] = '';
  try {
    const result = await assembleWithBinutils('.thumb\n');
    assert.ok(!result.ok);
    assert.deepEqual(result.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_MISSING']);
  } finally {
    process.env['PATH'] = saved;
  }
});
