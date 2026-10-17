import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Diagnostic } from '../../../src/api/rom.ts';
import { ExitCode, isExitCode, summarizeDiagnostics } from '../../../src/cli/exit-codes.ts';
import { diagnosticLine, recordLine, summaryLine } from '../../../src/cli/reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../../../src/cli/reporters/text.ts';

const full: Diagnostic = {
  code: 'E_ROM_NOT_GBA',
  severity: 'error',
  addr: 0x080000b2,
  span: { start: 0x08000000, end: 0x080000c0 },
  path: 'rom.gba',
  message: 'the fixed byte is 0x00, not 0x96',
  cites: [0x080000b2, 0x08000004],
  rule: 'header.fixed',
};
const bare: Diagnostic = { code: 'W_STALE_LOCK', severity: 'warning', message: 'a lock was left behind' };

test('formatDiagnosticText: code, severity, hex address, span, path, message', () => {
  assert.equal(
    formatDiagnosticText(full),
    'E_ROM_NOT_GBA error 0x080000B2 0x08000000..0x080000C0 rom.gba: the fixed byte is 0x00, not 0x96',
  );
  assert.equal(formatDiagnosticText(bare), 'W_STALE_LOCK warning: a lock was left behind');
  assert.equal(formatDiagnosticText({ ...bare, path: 'a/b' }), 'W_STALE_LOCK warning a/b: a lock was left behind');
});

test('formatSummaryText', () => {
  assert.equal(formatSummaryText({ ok: true, exitCode: ExitCode.ok }), 'ok (exit 0)');
  assert.equal(formatSummaryText({ ok: true, exitCode: ExitCode.ok, counts: {} }), 'ok (exit 0)');
  assert.equal(
    formatSummaryText({ ok: false, exitCode: ExitCode.errors, counts: { warning: 1, error: 2, info: 0 } }),
    'failed (exit 1): error 2, info 0, warning 1',
  );
});

function assertSortedKeys(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertSortedKeys(item);
    return;
  }
  const keys = Object.keys(value);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const key of keys) assertSortedKeys((value as Record<string, unknown>)[key]);
}

function parseLine(line: string): unknown {
  assert.ok(line.endsWith('\n'));
  assert.ok(!line.slice(0, -1).includes('\n'));
  const value: unknown = JSON.parse(line);
  assertSortedKeys(value);
  return value;
}

test('diagnosticLine: one sorted-key JSON object with hex addresses', () => {
  const line = diagnosticLine(full);
  assert.equal(
    line,
    '{"addr":"0x080000B2","cites":["0x080000B2","0x08000004"],"code":"E_ROM_NOT_GBA","message":"the fixed byte is 0x00, not 0x96",' +
      '"path":"rom.gba","rule":"header.fixed","severity":"error","span":{"end":"0x080000C0","start":"0x08000000"},"type":"diagnostic"}\n',
  );
  assert.deepEqual(parseLine(line), {
    addr: '0x080000B2',
    cites: ['0x080000B2', '0x08000004'],
    code: 'E_ROM_NOT_GBA',
    message: 'the fixed byte is 0x00, not 0x96',
    path: 'rom.gba',
    rule: 'header.fixed',
    severity: 'error',
    span: { end: '0x080000C0', start: '0x08000000' },
    type: 'diagnostic',
  });
  assert.deepEqual(parseLine(diagnosticLine({ ...bare, message: 'two\nlines "quoted"' })), {
    code: 'W_STALE_LOCK',
    message: 'two\nlines "quoted"',
    severity: 'warning',
    type: 'diagnostic',
  });
});

test('summaryLine and recordLine', () => {
  assert.equal(
    summaryLine({ ok: false, exitCode: ExitCode.verifyFailed, counts: { warning: 0, error: 1 } }),
    '{"counts":{"error":1,"warning":0},"exitCode":3,"ok":false,"type":"summary"}\n',
  );
  assert.equal(summaryLine({ ok: true, exitCode: ExitCode.ok }), '{"exitCode":0,"ok":true,"type":"summary"}\n');
  const check = recordLine('check', { name: 'as', ok: true, version: '2.43', details: { z: 1, a: [2, { y: null, b: 'x' }] } });
  assert.deepEqual(parseLine(check), {
    details: { a: [2, { b: 'x', y: null }], z: 1 },
    name: 'as',
    ok: true,
    type: 'check',
    version: '2.43',
  });
  assert.throws(() => recordLine('check', { type: 'other' }), { name: 'RomliftInvariantError' });
});

test('summarizeDiagnostics counts by severity and maps errors to exit 1', () => {
  assert.deepEqual(summarizeDiagnostics([]), { ok: true, exitCode: 0, counts: { error: 0, warning: 0, info: 0 } });
  assert.deepEqual(summarizeDiagnostics([bare, bare]), { ok: true, exitCode: 0, counts: { error: 0, warning: 2, info: 0 } });
  assert.deepEqual(summarizeDiagnostics([bare, full]), { ok: false, exitCode: 1, counts: { error: 1, warning: 1, info: 0 } });
});

test('isExitCode accepts exactly the five codes', () => {
  for (const code of [0, 1, 2, 3, 70]) assert.ok(isExitCode(code));
  for (const value of [4, -1, 70.5, '0', null, undefined]) assert.ok(!isExitCode(value));
});
