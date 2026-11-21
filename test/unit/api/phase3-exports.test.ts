// The phase-3 surface the lead froze, through the package entry points (D37, D43, D62): what wave 2 and the
// gates import. The wave-2 exports (buildModel, emitTree, verifyModel, planWrites, ...) are their owners'.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as romlift from 'romlift';

test('romlift exports the frozen phase-3 values', () => {
  const names = [
    'BUILD_COMPILERS',
    'DEFAULT_BUILD_COMPILER',
    'validateConfig',
    'sourceKey',
    'DEFAULT_MODULE_SIZE',
    'ItemKind',
    'ITEM_RAW_REASONS',
    'DATA_NOTES',
    'NO_SPEC',
    'itemAt',
    'findItem',
    'resolverFor',
    'wordValueOf',
    'moduleAt',
    'chunkPaths',
    'buildUnits',
    'HEADER_PATH',
    'CRT0_PATH',
    'LDSCRIPT_PATH',
    'SYMBOLS_PATH',
    'WRITER_IDS',
    'DEFAULT_PRINTER',
    'addPrintStats',
    'emptyPrintStats',
    'CHECK_IDS',
    'checkResult',
    'combineReports',
    'GENERATED_ROOTS',
    'MANIFEST_PATH',
    'JOURNAL_PATH',
    'LOCK_PATH',
    'ROMLIFT_DIR',
    'encodeManifest',
    'decodeManifest',
    'encodeJournal',
    'decodeJournal',
    'journalOf',
  ];
  for (const name of names) assert.ok(name in romlift, name);
  assert.equal(romlift.DEFAULT_MODULE_SIZE, 0x10000);
  assert.deepEqual(Object.keys(romlift.BUILD_COMPILERS), ['agbcc', 'old_agbcc']);
});
