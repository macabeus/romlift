// sourceKey (architecture §3.4, §6.5, D9, D62): the TOML `from` spelling of every persisted source; the
// analysis and module inference are never persisted.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sourceKey } from '../../../src/core/proposals/types.ts';

test('signature, evidence and legacy sources have their from-key spelling', () => {
  assert.equal(sourceKey({ kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.exact' }), 'sig:m4a@2001');
  assert.equal(sourceKey({ kind: 'evidence', id: 'trace' }), 'evidence:trace');
  assert.equal(sourceKey({ kind: 'evidence', id: 'elf' }), 'evidence:elf');
  assert.equal(sourceKey({ kind: 'evidence', id: 'map' }), 'evidence:map');
  assert.equal(sourceKey({ kind: 'legacy' }), 'legacy');
});

test('the analysis and module inference are never persisted', () => {
  assert.equal(sourceKey({ kind: 'analysis', rule: 'seed.call' }), undefined);
  for (const reason of ['header', 'startup', 'asm-only', 'module-size', 'data'] as const) assert.equal(sourceKey({ kind: 'layout', reason }), undefined);
});
