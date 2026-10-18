// The pinned PoC rows of the ROMs revealed after the PoC baseline (bench/src/poc-dump-rows.ts, D60).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dumpRowMismatch, parsePocDumpRows, pocDatasetDigest, pocDumpRowsText, pocRowDigest, POC_DUMP_ROWS_SCHEMA } from '../../../bench/src/poc-dump-rows.ts';
import { dataset } from './fixtures.ts';

const SOURCE = 'a'.repeat(64);
const ROW = { name: 'tiny', tp: 3, seconds: 12 };

test('the row digest ignores seconds and signatures; the dataset digest follows the lists', () => {
  assert.equal(pocRowDigest(ROW), pocRowDigest({ ...ROW, seconds: 99, signatures: { x: 1 } }));
  assert.notEqual(pocRowDigest(ROW), pocRowDigest({ ...ROW, tp: 4 }));
  const d = dataset();
  assert.equal(pocDatasetDigest(d), pocDatasetDigest({ ...d }));
  assert.notEqual(pocDatasetDigest(d), pocDatasetDigest({ ...d, untyped: [{ addr: '0x08000400', category: 'pointer-entry', note: 'n' }] }));
});

test('dumpRowMismatch: the dump must be of the pinned source, on the dataset of today, with the pinned row', () => {
  const d = dataset();
  const pinned = { schema: POC_DUMP_ROWS_SCHEMA, pocSourceDigest: SOURCE, roms: { [d.name]: { datasetDigest: pocDatasetDigest(d), rowDigest: pocRowDigest(ROW), tp: 3 } } } as const;
  assert.equal(dumpRowMismatch(d, pinned, SOURCE, pocDatasetDigest(d), ROW), undefined);
  assert.match(dumpRowMismatch(d, undefined, SOURCE, pocDatasetDigest(d), ROW) ?? '', /no pinned PoC row/);
  assert.match(dumpRowMismatch(d, pinned, 'b'.repeat(64), pocDatasetDigest(d), ROW) ?? '', /PoC source/);
  assert.match(dumpRowMismatch(d, pinned, SOURCE, null, ROW) ?? '', /PoC's own dataset file/);
  const changed = { ...d, untyped: [{ addr: '0x08000400', category: 'pointer-entry' as const, note: 'n' }] };
  assert.match(dumpRowMismatch(changed, pinned, SOURCE, pocDatasetDigest(d), ROW) ?? '', /made on dataset .* the dataset is now/);
  assert.match(dumpRowMismatch(changed, pinned, SOURCE, pocDatasetDigest(changed), ROW) ?? '', /re-pin/);
  assert.match(dumpRowMismatch(d, pinned, SOURCE, pocDatasetDigest(d), { ...ROW, tp: 4 }) ?? '', /row in the dump has digest/);
});

test('poc-dump-rows.json reads back what it writes', () => {
  const doc = { schema: POC_DUMP_ROWS_SCHEMA, pocSourceDigest: SOURCE, roms: { tmc: { datasetDigest: 'b'.repeat(64), rowDigest: 'c'.repeat(64), tp: 8582 } } } as const;
  assert.deepEqual(parsePocDumpRows(JSON.parse(pocDumpRowsText(doc)), 'x'), doc);
  assert.throws(() => parsePocDumpRows({ ...doc, schema: 'other' }, 'x'), /schema/);
  assert.throws(() => parsePocDumpRows({ ...doc, roms: { tmc: { datasetDigest: 'z', rowDigest: 'c'.repeat(64), tp: 1 } } }, 'x'), /sha256/);
});
