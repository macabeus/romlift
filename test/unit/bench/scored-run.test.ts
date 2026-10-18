import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MISS_REASONS } from 'romlift';

import { analysisDigest } from '../../../bench/src/scored-run.ts';
import { scoredFromChild } from '../../../bench/tools/export-poc.ts';
import { missReasonId, originId, parseScoredRun } from '../../../bench/src/scored-run.ts';
import { dump, fn } from './fixtures.ts';

test('missReasonId maps every PoC diagnosis to its reason id', () => {
  const cases: ReadonlyArray<readonly [string, keyof typeof MISS_REASONS]> = [
    ['inside code of the accepted function at 08000380', 'inside-code'],
    ['inside a literal pool of the accepted function at ?', 'inside-code'],
    ['ARM routine never reached: not a bl, adr or veneer target of accepted code; no ARM gap scan', 'arm-unreached'],
    ['fails validity: not dense', 'not-dense'],
    ['fails validity: a return path pops more than it pushed', 'pops-frame'],
    ['fails validity: no return and no push {.., lr}', 'no-return-no-prologue'],
    ['fails validity: its pool overlaps claimed bytes', 'pool-claimed'],
    ['fails validity: its words are Thumb code pointers', 'pointer-table'],
    ['fails validity: calls 080001F0, which is not code', 'calls-non-code'],
    ['valid but not accepted: anchored at start, has push {.., lr}', 'unanchored'],
    ['fails validity: undefined instruction at 08000400', 'decode-error'],
  ];
  for (const [text, id] of cases) assert.equal(missReasonId(text), id, text);
  assert.deepEqual(new Set(cases.map(([, id]) => id)), new Set(Object.keys(MISS_REASONS)));
});

test('originId turns a PoC origin text into its id, and rejects text that names none', () => {
  assert.equal(originId('rom entry'), 'rom-entry');
  assert.equal(originId('startup pointer'), 'startup-pointer');
  assert.equal(originId('call'), 'call');
  assert.equal(originId('arm gap scan'), 'arm-gap-scan');
  assert.equal(originId('tiled hole'), 'tiled-hole');
  assert.equal(originId('magic'), undefined);
  assert.equal(originId(''), undefined);
});

test('parseScoredRun accepts the frozen shape and names the first field that is not', () => {
  const value = JSON.parse(JSON.stringify(dump({ analysis: { functions: [fn('0x08000000', '0x08000010')], startup: { end: '0x08000000', entries: [] }, codeRange: ['0x08000000', '0x08000010'] } }))) as Record<string, unknown>;
  assert.equal(parseScoredRun(value, 'x').analysis.functions.length, 1);
  assert.throws(() => parseScoredRun({ ...value, schema: 'other' }, 'x'), /schema is other/);
  assert.throws(() => parseScoredRun({ ...value, digests: ['a'] }, 'x'), /digests must hold two/);
  const bad = { ...value, analysis: { functions: [fn('0x8000000', '0x08000010')], startup: { end: '0x08000000', entries: [] }, codeRange: ['0x08000000', '0x08000010'] } };
  assert.throws(() => parseScoredRun(bad, 'x'), /analysis.functions\[0\].entry/);
});

test('export-poc builds the frozen document: digests of each analysis, the row without seconds', () => {
  const analysis = { functions: [fn('0x08000000', '0x08000010', 'rom entry', 'arm')], startup: { end: '0x08000010', entries: ['0x08000000'] }, codeRange: ['0x08000000', '0x08000010'] };
  const other = { ...analysis, codeRange: ['0x08000000', '0x08000014'] };
  const row = { name: 'tiny', seconds: 1.5, tp: 1, scaffold: { ok: true, seconds: 2, summary: 'built' } };
  const scored = scoredFromChild({ analyses: [analysis, other], misses: [{ addr: '0x08000020', reason: 'inside code' }], row }, 'tiny', 'f'.repeat(40), 'p'.repeat(64));
  assert.equal(scored.schema, 'romlift-bench/poc-scored@1');
  assert.deepEqual(Object.keys(scored), ['schema', 'rom', 'sha1', 'pocSourceDigest', 'datasetDigest', 'analysis', 'misses', 'digests', 'scaffold', 'pocRow']);
  // The dataset digest is recorded only when the child ran on the dataset romlift handed it.
  assert.equal(scored.datasetDigest, null);
  assert.equal(scoredFromChild({ analyses: [analysis, other], misses: [], row, dataset: 'poc' }, 'tiny', 'f'.repeat(40), 'p'.repeat(64), 'd'.repeat(64)).datasetDigest, null);
  assert.equal(scoredFromChild({ analyses: [analysis, other], misses: [], row, dataset: 'given' }, 'tiny', 'f'.repeat(40), 'p'.repeat(64), 'd'.repeat(64)).datasetDigest, 'd'.repeat(64));
  assert.equal(scored.digests[0], analysisDigest(analysis));
  assert.notEqual(scored.digests[0], scored.digests[1]);
  // Canonical JSON: the digest does not depend on key order.
  assert.equal(analysisDigest({ codeRange: analysis.codeRange, startup: analysis.startup, functions: analysis.functions }), scored.digests[0]);
  assert.deepEqual(scored.scaffold, { ok: true, summary: 'built' });
  assert.deepEqual(scored.pocRow, { name: 'tiny', tp: 1, scaffold: { ok: true, summary: 'built' } });
  assert.throws(() => scoredFromChild({ analyses: [analysis], row }, 'tiny', '', ''), /printed no/);
});
