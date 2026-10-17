// `romlift doctor` end to end as a child process with stdin closed (the real toolchain, skipped as
// unavailable when it is not installed; and a PATH without it), plus the pure exit-code and output
// functions of the command.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { doctorExitCode, doctorNdjson, doctorText } from '../../../src/cli/commands/doctor.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import type { DoctorCheck, DoctorReport } from '../../../src/shell/toolchain/doctor.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IDS = ['binutils', 'corpus', 'thumb-jump11', 'agbcc', 'old_agbcc'];
const available = !('code' in findBinutils(process.env));

interface Line {
  readonly type: string;
  readonly [key: string]: unknown;
}

function doctor(args: readonly string[], env: NodeJS.ProcessEnv): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, ['--conditions=source', 'src/cli/main.ts', 'doctor', ...args], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function lines(stdout: string): Line[] {
  assert.ok(stdout.endsWith('\n'), 'the output ends with a newline');
  return stdout
    .slice(0, -1)
    .split('\n')
    .map((text) => JSON.parse(text) as Line);
}

function report(statuses: Readonly<Record<string, DoctorCheck['status']>>): DoctorReport {
  const checks = IDS.map((id): DoctorCheck => ({ id: id as DoctorCheck['id'], status: statuses[id] ?? 'ok', detail: `${id} detail` }));
  return { checks, diagnostics: [], ok: checks.slice(0, 3).every((c) => c.status === 'ok') };
}

test('doctor --json with the real toolchain exits 0: checks in order, then the summary', { skip: available ? false : 'unavailable: toolchain' }, () => {
  const result = doctor(['--json'], process.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const parsed = lines(result.stdout);
  const checks = parsed.filter((l) => l.type === 'check');
  assert.deepEqual(checks.map((l) => l.id), IDS);
  for (const check of checks) {
    assert.deepEqual(Object.keys(check).sort(), ['detail', 'id', 'status', 'type']);
    assert.ok(['ok', 'missing', 'fail'].includes(String(check['status'])));
    assert.equal(typeof check['detail'], 'string');
  }
  assert.deepEqual(checks.slice(0, 3).map((l) => l.status), ['ok', 'ok', 'ok']);
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: true, exitCode: 0 });
  assert.equal(parsed.filter((l) => l.type === 'summary').length, 1);
  assert.ok(parsed.every((l) => ['check', 'diagnostic', 'summary'].includes(l.type)));
});

test('doctor --json without the toolchain on the PATH exits 1 with E_TOOLCHAIN_MISSING', () => {
  const result = doctor(['--json'], { PATH: '' });
  assert.equal(result.status, 1, result.stderr);
  const parsed = lines(result.stdout);
  assert.deepEqual(parsed.filter((l) => l.type === 'check').map((l) => [l.id, l.status]), IDS.map((id) => [id, 'missing']));
  assert.deepEqual(parsed.filter((l) => l.type === 'diagnostic').map((l) => l['code']), ['E_TOOLCHAIN_MISSING']);
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
});

test('doctor in text mode prints one line per check and the verdict', () => {
  const result = doctor([], { PATH: '' });
  assert.equal(result.status, 1);
  const out = result.stdout.trimEnd().split('\n');
  assert.equal(out.length, IDS.length + 1);
  IDS.forEach((id, i) => assert.match(out[i] ?? '', new RegExp(`^${id} +missing  `)));
  assert.equal(out.at(-1), 'doctor: failed (exit 1)');
  assert.match(result.stderr, /^E_TOOLCHAIN_MISSING error: not on the PATH: /);
});

test('the exit code: 0 when the three required checks are ok, 1 without binutils, 3 when the corpus or probe fails', () => {
  assert.equal(doctorExitCode(report({ agbcc: 'missing', old_agbcc: 'missing' })), ExitCode.ok);
  assert.equal(doctorExitCode(report({ binutils: 'missing', corpus: 'missing', 'thumb-jump11': 'missing' })), ExitCode.errors);
  assert.equal(doctorExitCode(report({ binutils: 'fail', corpus: 'missing', 'thumb-jump11': 'missing' })), ExitCode.errors);
  assert.equal(doctorExitCode(report({ corpus: 'fail' })), ExitCode.verifyFailed);
  assert.equal(doctorExitCode(report({ 'thumb-jump11': 'fail' })), ExitCode.verifyFailed);
});

test('the NDJSON and text renderings of a report', () => {
  const failing = report({ 'thumb-jump11': 'fail', agbcc: 'missing' });
  const summary = { ok: false, exitCode: ExitCode.verifyFailed };
  const json = doctorNdjson(failing, summary).split('\n');
  assert.equal(json[2], '{"detail":"thumb-jump11 detail","id":"thumb-jump11","status":"fail","type":"check"}');
  assert.equal(json[5], '{"exitCode":3,"ok":false,"type":"summary"}');
  const text = doctorText(failing, summary);
  assert.equal(text.stdout.split('\n')[2], 'thumb-jump11  fail     thumb-jump11 detail');
  assert.ok(text.stdout.endsWith('doctor: failed (exit 3)\n'));
  assert.equal(text.stderr, '');
});
