// What the commands share (src/cli/commands/command-common.ts, D77 j, D78 f): a refusal's exit code tells a self-check
// (3) from an input or model error (1), a checked run's tells them apart the same way, and a write's op counts list
// every kind (fix round 3, architecture-a1-9).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Diagnostic } from '../../../src/api/rom.ts';
import { VERIFY_CODES, opCounts, refusedExitCode, verifyExitCode } from '../../../src/cli/commands/command-common.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';

const error = (code: string): Diagnostic => ({ code, severity: 'error', message: code }) as Diagnostic;
const warning = (code: string): Diagnostic => ({ code, severity: 'warning', message: code }) as Diagnostic;
const CHECK_CODE = [...VERIFY_CODES][0] ?? assert.fail('the self-checks raise codes');

test('refusedExitCode: 1 for an input or model error, 3 for a self-check alone or a silent refusal', () => {
  assert.equal(refusedExitCode([error('E_MODULE_BORDER')]), ExitCode.errors);
  assert.equal(refusedExitCode([error(CHECK_CODE), error('E_C_STALE_DEFINITION')]), ExitCode.errors);
  assert.equal(refusedExitCode([error(CHECK_CODE)]), ExitCode.verifyFailed);
  assert.equal(refusedExitCode([warning('W_C_ORDER')]), ExitCode.verifyFailed);
  assert.equal(refusedExitCode([]), ExitCode.verifyFailed);
});

test("verifyExitCode: an input error over a failed check, a failed check over success; a check's own diagnostics count", () => {
  const ok = { id: 'tiling', ok: true, detail: '', diagnostics: [] } as const;
  const failed = { id: 'tiling', ok: false, detail: '', diagnostics: [error(CHECK_CODE)] } as const;
  assert.equal(
    verifyExitCode({ report: { ok: true, checks: [ok] }, diagnostics: [warning('W_LISTED_INVALID')] }),
    ExitCode.ok,
  );
  assert.equal(verifyExitCode({ report: { ok: false, checks: [failed] }, diagnostics: [] }), ExitCode.verifyFailed);
  assert.equal(
    verifyExitCode({ report: { ok: false, checks: [failed] }, diagnostics: [error('E_MODULE_BORDER')] }),
    ExitCode.errors,
  );
  const inCheck = { ...failed, diagnostics: [error('E_TOOLCHAIN_FAILED')] };
  assert.equal(verifyExitCode({ report: { ok: false, checks: [inCheck] }, diagnostics: [] }), ExitCode.errors);
});

test('opCounts: every op kind, zero when absent, in a fixed key order', () => {
  assert.deepEqual(opCounts([]), { write: 0, edit: 0, delete: 0, keep: 0 });
  const ops = [
    { op: 'keep', path: 'a' },
    { op: 'write', path: 'b' },
    { op: 'keep', path: 'c' },
    { op: 'mode', path: 'd' },
  ] as unknown as Parameters<typeof opCounts>[0];
  const counts = opCounts(ops);
  assert.deepEqual(counts, { write: 1, edit: 0, delete: 0, keep: 2, mode: 1 });
  assert.deepEqual(Object.keys(counts), ['write', 'edit', 'delete', 'keep', 'mode']);
});
