// runDoctor with the real toolchain (skipped as unavailable when it is not installed), with an empty
// PATH, and with a fake toolchain whose `as` fails; plus the pure parts: the Thumb branch encoding and
// the corpus options.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DEFAULT_CORPUS_OPTIONS } from '../../../../src/foundation/isa/corpus.ts';
import { findBinutils } from '../../../../src/shell/toolchain/binutils.ts';
import { DOCTOR_ARM_SAMPLE, DOCTOR_CHECK_IDS, doctorCorpusOptions, runDoctor, thumbBranch } from '../../../../src/shell/toolchain/doctor.ts';
import type { DoctorCheck, DoctorReport } from '../../../../src/shell/toolchain/doctor.ts';

const available = !('code' in findBinutils(process.env));
const toolchain = { skip: available ? false : 'unavailable: toolchain' };

function check(report: DoctorReport, id: DoctorCheck['id']): DoctorCheck {
  const found = report.checks.find((c) => c.id === id);
  assert.ok(found !== undefined, `no ${id} check`);
  return found;
}

async function withDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-doctor-test-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function executable(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  await chmod(file, 0o755);
}

test('the Thumb branch encoding covers both ends of the JUMP11 range', () => {
  assert.equal(thumbBranch(0x0800_0000, 0x0800_0004), 0xe000);
  assert.equal(thumbBranch(0x0800_0000, 0x0800_0802), 0xe3ff);
  assert.equal(thumbBranch(0x0800_1000, 0x0800_0804), 0xe400);
  assert.equal(thumbBranch(0x0800_0000, 0x0800_0002), 0xe7ff);
});

test('the corpus options: 65,536 ARM words by default, the CI size with full, or the override', () => {
  assert.equal(doctorCorpusOptions({}).armSample, DOCTOR_ARM_SAMPLE);
  assert.equal(doctorCorpusOptions({ full: true }).armSample, DEFAULT_CORPUS_OPTIONS.armSample);
  assert.equal(doctorCorpusOptions({ full: true, armSample: 16 }).armSample, 16);
  assert.equal(doctorCorpusOptions({}).seed, DEFAULT_CORPUS_OPTIONS.seed);
  assert.equal(doctorCorpusOptions({}).blSample, DEFAULT_CORPUS_OPTIONS.blSample);
});

test('with the real toolchain every required check is ok and nothing is left in the temp directory', toolchain, async () => {
  // os.tmpdir() follows TMPDIR; a private one proves every temporary file is under it and removed.
  const { report, left } = await withDir(async (dir) => {
    const temp = path.join(dir, 'tmp');
    const cwd = path.join(dir, 'project');
    await mkdir(temp);
    await mkdir(cwd);
    const saved = process.env['TMPDIR'];
    process.env['TMPDIR'] = temp;
    try {
      assert.equal(tmpdir(), temp);
      return { report: await runDoctor({ env: process.env, cwd, armSample: 1024 }), left: await readdir(temp) };
    } finally {
      if (saved === undefined) delete process.env['TMPDIR'];
      else process.env['TMPDIR'] = saved;
    }
  });
  assert.deepEqual(left, []);
  assert.deepEqual(report.checks.map((c) => c.id), DOCTOR_CHECK_IDS);
  assert.equal(check(report, 'binutils').status, 'ok');
  assert.match(check(report, 'binutils').detail, /GNU assembler .*GNU ld .*GNU objcopy /);
  const corpus = check(report, 'corpus');
  assert.equal(corpus.status, 'ok', corpus.detail);
  assert.match(corpus.detail, /^\d+ cases \(thumb \d+, bl \d+, arm \d+; ARM sample 1024\); disagreements: as 0, encoder 0, context 0; raw: undefined \d+, unpredictable \d+, sbz-set \d+, as-alias \d+, no-roundtrip \d+$/);
  const jump11 = check(report, 'thumb-jump11');
  assert.equal(jump11.status, 'ok', jump11.detail);
  assert.match(jump11.detail, /expected 0xE3FF, got 0xE3FF$/);
  assert.ok(report.ok);
  assert.deepEqual(report.diagnostics, []);
});

test('an empty PATH: binutils missing with E_TOOLCHAIN_MISSING, the dependent checks missing, ok false', async () => {
  const report = await withDir((cwd) => runDoctor({ env: { PATH: '' }, cwd }));
  assert.deepEqual(report.checks.map((c) => c.id), DOCTOR_CHECK_IDS);
  assert.deepEqual(report.checks.map((c) => c.status), ['missing', 'missing', 'missing', 'missing', 'missing']);
  assert.deepEqual(report.diagnostics.map((d) => [d.code, d.severity]), [['E_TOOLCHAIN_MISSING', 'error']]);
  assert.equal(report.ok, false);
});

test('agbcc and old_agbcc are found under <cwd>/tools/agbcc/bin, and on the PATH first', async () => {
  await withDir(async (dir) => {
    const cwd = path.join(dir, 'project');
    await executable(path.join(cwd, 'tools', 'agbcc', 'bin', 'agbcc'), '#!/bin/sh\n');
    const local = await runDoctor({ env: { PATH: '' }, cwd });
    assert.deepEqual(check(local, 'agbcc'), { id: 'agbcc', status: 'ok', detail: path.join(cwd, 'tools', 'agbcc', 'bin', 'agbcc') });
    assert.equal(check(local, 'old_agbcc').status, 'missing');
    assert.match(check(local, 'old_agbcc').detail, /tools\/agbcc\/bin\/old_agbcc$/);
    const bin = path.join(dir, 'bin');
    await executable(path.join(bin, 'old_agbcc'), '#!/bin/sh\n');
    await executable(path.join(bin, 'agbcc'), '#!/bin/sh\n');
    const onPath = await runDoctor({ env: { PATH: bin }, cwd });
    assert.deepEqual(check(onPath, 'agbcc'), { id: 'agbcc', status: 'ok', detail: `${path.join(bin, 'agbcc')} (PATH)` });
    assert.deepEqual(check(onPath, 'old_agbcc'), { id: 'old_agbcc', status: 'ok', detail: `${path.join(bin, 'old_agbcc')} (PATH)` });
  });
});

test('binutils that run but cannot assemble: the corpus and the probe fail, ok false', async () => {
  await withDir(async (dir) => {
    const fake = '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "GNU fake 0.0"; exit 0; fi\necho "fake: cannot assemble" >&2\nexit 1\n';
    for (const tool of ['as', 'ld', 'objcopy']) await executable(path.join(dir, `arm-none-eabi-${tool}`), fake);
    const report = await runDoctor({ env: { PATH: dir }, cwd: dir, armSample: 0 });
    assert.equal(check(report, 'binutils').status, 'ok');
    const corpus = check(report, 'corpus');
    assert.equal(corpus.status, 'fail');
    assert.match(corpus.detail, /disagreements: as [1-9]\d*, /);
    assert.match(corpus.detail, /first: .* got as failed: fake: cannot assemble/);
    const jump11 = check(report, 'thumb-jump11');
    assert.equal(jump11.status, 'fail');
    assert.match(jump11.detail, /arm-none-eabi-as exited with 1 on branch\.s: fake: cannot assemble$/);
    assert.deepEqual(report.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_FAILED']);
    assert.equal(report.ok, false);
  });
});

test('binutils whose --version prints nothing fail the binutils check', async () => {
  await withDir(async (dir) => {
    for (const tool of ['as', 'ld', 'objcopy']) await executable(path.join(dir, `arm-none-eabi-${tool}`), '#!/bin/sh\nexit 1\n');
    const report = await runDoctor({ env: { PATH: dir }, cwd: dir });
    assert.deepEqual(report.checks.map((c) => c.status), ['fail', 'missing', 'missing', 'missing', 'missing']);
    assert.deepEqual(report.diagnostics.map((d) => d.code), ['E_TOOLCHAIN_FAILED']);
    assert.match(report.diagnostics[0]?.message ?? '', /--version failed for arm-none-eabi-as, arm-none-eabi-ld, arm-none-eabi-objcopy/);
    assert.equal(report.ok, false);
  });
});
