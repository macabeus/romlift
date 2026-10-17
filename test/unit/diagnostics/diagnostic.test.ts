import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defineCodes, diagnostic, RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';

const FixtureCodes = defineCodes({
  E_FIXTURE: { severity: 'error', meaning: 'a fixture error' },
  W_FIXTURE: { severity: 'warning', meaning: 'a fixture warning' },
  I_FIXTURE: { severity: 'info', meaning: 'a fixture note' },
});

test('defineCodes returns its table unchanged, with literal severities', () => {
  assert.equal(FixtureCodes.E_FIXTURE.severity, 'error');
  const severity: 'warning' = FixtureCodes.W_FIXTURE.severity;
  assert.equal(severity, 'warning');
  assert.deepEqual(Object.keys(FixtureCodes), ['E_FIXTURE', 'W_FIXTURE', 'I_FIXTURE']);
});

test('diagnostic takes its severity from the table', () => {
  assert.deepEqual(diagnostic(FixtureCodes, 'W_FIXTURE', 'careful'), {
    code: 'W_FIXTURE',
    severity: 'warning',
    message: 'careful',
  });
  assert.equal(diagnostic(FixtureCodes, 'I_FIXTURE', 'fyi').severity, 'info');
});

test('diagnostic copies the given extra fields and omits the absent ones', () => {
  const cites = [0x0800_0000];
  const d: Diagnostic<'E_FIXTURE' | 'W_FIXTURE' | 'I_FIXTURE'> = diagnostic(FixtureCodes, 'E_FIXTURE', 'broken', {
    addr: 0x0800_0010,
    span: { start: 0x0800_0010, end: 0x0800_0020 },
    path: 'src/x.c',
    cites,
    rule: 'walk.example',
  });
  assert.deepEqual(d, {
    code: 'E_FIXTURE',
    severity: 'error',
    message: 'broken',
    addr: 0x0800_0010,
    span: { start: 0x0800_0010, end: 0x0800_0020 },
    path: 'src/x.c',
    cites: [0x0800_0000],
    rule: 'walk.example',
  });
  cites.push(1);
  assert.deepEqual(d.cites, [0x0800_0000], 'cites is a copy');
  assert.deepEqual(Object.keys(diagnostic(FixtureCodes, 'E_FIXTURE', 'm', { path: 'p' })), ['code', 'severity', 'message', 'path']);
});

test('RomliftInvariantError is an Error with its own name', () => {
  const error = new RomliftInvariantError('broken invariant');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'RomliftInvariantError');
  assert.equal(error.message, 'broken invariant');
});
