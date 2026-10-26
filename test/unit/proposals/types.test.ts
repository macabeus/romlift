// sourceKey (architecture §3.4, §6.5, D9, D62, D91, D92): the TOML `from` spelling of the one persisted source,
// signatures; the analysis and module inference are never persisted. The evidence and legacy sources were dropped
// with their importers (D91, D92), so no other spelling exists.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseSourceKey, sourceKey } from '../../../src/core/proposals/types.ts';
import type { ProposalSource } from '../../../src/core/proposals/types.ts';

test('a signature source is spelled sig:<library>@<version>', () => {
  assert.equal(sourceKey({ kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' }), 'sig:m4a@2001');
  assert.equal(sourceKey({ kind: 'signature', library: 'libagbsyscall', version: 'agb', rule: 'sig.link-order-run' }), 'sig:libagbsyscall@agb');
});

test('the analysis and module inference are never persisted', () => {
  assert.equal(sourceKey({ kind: 'analysis', rule: 'seed.call' }), undefined);
  for (const reason of ['header', 'startup', 'asm-only', 'module-size', 'data'] as const) assert.equal(sourceKey({ kind: 'layout', reason }), undefined);
});

test('the source kinds are exactly signature, analysis and layout', () => {
  const kinds: Record<ProposalSource['kind'], true> = { signature: true, analysis: true, layout: true };
  assert.deepEqual(Object.keys(kinds).sort(), ['analysis', 'layout', 'signature']);
});

test('parseSourceKey reads back what sourceKey spells, and nothing else (architecture-12)', () => {
  for (const [library, version] of [['m4a', '2001'], ['libagbsyscall', 'agb'], ['lib', 'v1@beta']] as const) {
    const key = sourceKey({ kind: 'signature', library, version, rule: 'sig.unique-fit' });
    assert.deepEqual(parseSourceKey(key), { library, version });
  }
  for (const other of [undefined, '', 'sig:', 'sig:m4a', 'sig:@2001', 'sig:m4a@', 'elf:m4a@2001', 'm4a@2001']) assert.equal(parseSourceKey(other), undefined, String(other));
});
