// The verify report (architecture §6.4, D49, D62): a check is ok without error diagnostics, and reports
// combine into one, checks in CHECK_IDS order, two results of one id merged.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHECK_IDS, checkResult, combineReports } from '../../../src/core/verify/report.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';

const error: Diagnostic = { code: 'E_SELF_CHECK_TEXT', severity: 'error', message: 'byte differs', path: 'asm/main.s' };
const warning: Diagnostic = { code: 'W_CROSS_MODULE_SHORT_BRANCH', severity: 'warning', message: 'raw branch' };

test('a check is ok unless one of its diagnostics is an error', () => {
  assert.deepEqual(checkResult('tiling', [], 'every byte in one item'), {
    id: 'tiling',
    ok: true,
    detail: 'every byte in one item',
    diagnostics: [],
  });
  assert.equal(checkResult('reencode', [warning], '').ok, true);
  assert.equal(checkResult('text-layout', [warning, error], '').ok, false);
});

test('reports combine in CHECK_IDS order and merge one id', () => {
  const model = { ok: true, checks: [checkResult('module-size', [], 'sizes'), checkResult('tiling', [], 'tiling')] };
  const text1 = { ok: false, checks: [checkResult('text-layout', [error], 'asm/main.s:3')] };
  const text2 = {
    ok: true,
    checks: [checkResult('text-layout', [warning], '4 files'), checkResult('paths', [], '5 paths')],
  };
  const combined = combineReports(text1, model, text2);
  assert.deepEqual(
    combined.checks.map((c) => c.id),
    ['tiling', 'module-size', 'text-layout', 'paths'],
  );
  assert.equal(combined.ok, false);
  const text = combined.checks[2];
  assert.ok(text !== undefined && !text.ok);
  assert.equal(text.detail, 'asm/main.s:3', 'the failing detail');
  assert.deepEqual(text.diagnostics, [error, warning]);
  assert.equal(combineReports(model, text2).ok, true);
  assert.deepEqual(combineReports(), { ok: true, checks: [] });
  assert.deepEqual(CHECK_IDS, ['tiling', 'reencode', 'module-size', 'text-layout', 'paths', 'assemble', 'link']);
});
