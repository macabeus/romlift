import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';
import { isMissReason, isOrigin, MISS_REASONS, ORIGINS } from 'romlift';

import { loadDatasets } from '../../../bench/src/dataset.ts';
import { contextFromEnv } from '../../../bench/src/context.ts';
import { EXCEPTION_CATEGORIES, isExceptionCategory } from '../../../bench/src/vocabulary.ts';

const ID = /^[a-z][a-z0-9-]*$/;

function assertDefined(name: string, vocabulary: Readonly<Record<string, string>>): void {
  for (const [id, meaning] of Object.entries(vocabulary)) {
    assert.match(id, ID, `${name}: ${id} is not a kebab-case id`);
    assert.ok(meaning.trim().length > 0, `${name}: ${id} has no definition`);
  }
}

test('the miss reasons are the PoC ten, each defined', () => {
  assert.deepEqual(Object.keys(MISS_REASONS), [
    'inside-code',
    'arm-unreached',
    'not-dense',
    'pops-frame',
    'no-return-no-prologue',
    'pool-claimed',
    'pointer-table',
    'calls-non-code',
    'decode-error',
    'unanchored',
  ]);
  assertDefined('MISS_REASONS', MISS_REASONS);
});

test('the origins are the PoC ten plus listed, override and evidence, each defined', () => {
  assert.deepEqual(Object.keys(ORIGINS), [
    'rom-entry',
    'startup-pointer',
    'call',
    'veneer',
    'adr',
    'pool-pointer',
    'data-pointer',
    'gap-scan',
    'arm-gap-scan',
    'tiled-hole',
    'listed',
    'override',
    'evidence',
  ]);
  assertDefined('ORIGINS', ORIGINS);
});

test('the vocabularies are exported from romlift and their guards accept only defined ids', () => {
  assert.equal(romlift.MISS_REASONS, MISS_REASONS);
  assert.equal(romlift.ORIGINS, ORIGINS);
  assert.ok(isMissReason('inside-code'));
  assert.ok(!isMissReason('inside code'));
  assert.ok(!isMissReason('toString'));
  assert.ok(isOrigin('gap-scan'));
  assert.ok(!isOrigin('gap scan'));
  assert.ok(!isOrigin('constructor'));
});

test('the exception categories are the PoC eight, each defined', () => {
  assert.equal(Object.keys(EXCEPTION_CATEGORIES).length, 8);
  assertDefined('EXCEPTION_CATEGORIES', EXCEPTION_CATEGORIES);
  assert.ok(isExceptionCategory('mixer-internal'));
  assert.ok(!isExceptionCategory('second-entry'));
});

test('every row of the committed datasets carries a defined category', async () => {
  const { datasets, problems } = await loadDatasets(contextFromEnv({}));
  assert.deepEqual(problems, []);
  assert.ok(datasets.length >= 5);
  for (const d of datasets) {
    for (const row of [...d.labels, ...d.untyped]) assert.ok(isExceptionCategory(row.category), `${d.name} ${row.addr}: ${row.category}`);
  }
});
