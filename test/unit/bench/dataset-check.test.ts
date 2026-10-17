import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkDatasetAgainstRun } from '../../../bench/src/dataset-check.ts';
import { scoreRun } from '../../../bench/src/score.ts';
import { elfTruth } from '../../../bench/src/truth.ts';
import { dataset, dump, elfFile, fn } from './fixtures.ts';

const ELF = elfFile([
  { name: 'host', value: 0x0800_0101, size: 0x40 },
  { name: 'inner', value: 0x0800_0121, size: 0 },
  { name: 'free', value: 0x0800_0301, size: 8 },
]);
const TRUTH = elfTruth(ELF, 0x1000);
const DUMP = dump({
  analysis: {
    functions: [fn('0x08000100', '0x08000140'), fn('0x08000200', '0x08000210', 'gap scan')],
    startup: { end: '0x08000000', entries: [] },
    codeRange: ['0x08000100', '0x08000210'],
  },
  misses: [
    { addr: '0x08000120', reason: 'inside code of the accepted function at 08000100' },
    { addr: '0x08000300', reason: 'valid but not accepted: nothing points at it' },
  ],
});

function problems(labels: readonly string[], untyped: readonly string[]): string[] {
  const d = dataset({
    labels: labels.map((addr) => ({ addr, name: `sub_${addr}`, category: 'loop-label', note: 'n' })),
    untyped: untyped.map((addr) => ({ addr, category: 'unreviewed', note: 'n' })),
  });
  const row = scoreRun({ dump: DUMP, truth: TRUTH, dataset: d, sha1: '' });
  return checkDatasetAgainstRun(d, TRUTH, DUMP, row).map((p) => `${p.list} ${p.addr} ${p.problem}`);
}

test('a label that is a FUNC inside a found function and still missed, and a needed untyped row, pass', () => {
  assert.deepEqual(problems(['0x08000120'], ['0x08000200']), []);
});

test('a label that is not a FUNC symbol is reported', () => {
  assert.deepEqual(problems(['0x08000124'], []), ['labels 0x08000124 not-a-func', 'labels 0x08000124 stale-exception']);
});

test('a label that is a FUNC outside every found function is reported', () => {
  assert.deepEqual(problems(['0x08000300'], []), ['labels 0x08000300 not-inside-found-function']);
});

test('a label the run finds as an entry is not inside a found function and is stale', () => {
  assert.deepEqual(problems(['0x08000100'], []), ['labels 0x08000100 not-inside-found-function', 'labels 0x08000100 stale-exception']);
});

test('an untyped row that is a FUNC symbol is reported', () => {
  assert.deepEqual(problems([], ['0x08000300']), ['untyped 0x08000300 is-a-func', 'untyped 0x08000300 stale-exception']);
});

test('an untyped row the run no longer reports is stale', () => {
  assert.deepEqual(problems([], ['0x08000208']), ['untyped 0x08000208 stale-exception']);
});
