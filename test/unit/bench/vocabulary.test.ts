import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';
import { isMissReason, isOrigin, MISS_REASONS, ORIGINS } from 'romlift';

import { loadDatasets } from '../../../bench/src/dataset.ts';
import { contextFromEnv } from '../../../bench/src/context.ts';
import { CLASSIFIER_CATEGORIES, EXCEPTION_CATEGORIES, isArtifactCategory, isExceptionCategory, isRowCategory, RETIRED_CATEGORIES, UNREVIEWED } from '../../../bench/src/vocabulary.ts';

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

test('the exception categories: the PoC eight less two, plus the four of milestone M5, each defined', () => {
  assert.deepEqual(Object.keys(EXCEPTION_CATEGORIES), [
    'loop-label',
    'mixer-internal',
    'startup',
    'veneer',
    'local-subroutine',
    'adr-callback',
    'second-entry',
    'untyped-leaf',
    'split-after-returning-call',
    'disassembler-split',
  ]);
  assertDefined('EXCEPTION_CATEGORIES', EXCEPTION_CATEGORIES);
  assert.ok(isExceptionCategory('second-entry'));
  assert.ok(!isExceptionCategory('continuation-after-noreturn-call'), 'replaced by split-after-returning-call (D26)');
  assert.ok(!isExceptionCategory(UNREVIEWED), 'unreviewed is the adopt placeholder, not a category');
  assert.ok(isRowCategory(UNREVIEWED) && isRowCategory('veneer') && !isRowCategory('toString'));
});

test('every row of the committed datasets carries a defined category, none the placeholder', async () => {
  const { datasets, problems } = await loadDatasets(contextFromEnv({}));
  assert.deepEqual(problems, []);
  assert.ok(datasets.length >= 5);
  for (const d of datasets) {
    for (const row of [...d.labels, ...d.untyped]) assert.ok(isExceptionCategory(row.category), `${d.name} ${row.addr}: ${row.category}`);
  }
});

test('every category is carried by a committed dataset row or a sealed classifier (architecture §8.3)', async () => {
  const { datasets } = await loadDatasets(contextFromEnv({}));
  const carried = new Set<string>(CLASSIFIER_CATEGORIES);
  for (const d of datasets) for (const row of [...d.labels, ...d.untyped]) carried.add(row.category);
  for (const id of Object.keys(EXCEPTION_CATEGORIES)) assert.ok(carried.has(id), `${id} is carried by no dataset row and no classifier`);
});

test('a retired category is readable in an artifact committed before M5, never in a dataset', () => {
  assert.ok(isArtifactCategory('continuation-after-noreturn-call'));
  assert.ok(!isRowCategory('continuation-after-noreturn-call'));
  assert.ok(Object.keys(RETIRED_CATEGORIES).every((id) => !isExceptionCategory(id)));
  assert.ok(!isArtifactCategory('not-a-category'));
});
