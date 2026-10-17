import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHeader } from '../../../src/foundation/rom/header.ts';
import { syntheticRom } from './synthetic.ts';

test('parseHeader reads title, game code, maker code and version', () => {
  const bytes = syntheticRom({ title: 'POCKET DEMO', gameCode: 'APDJ', makerCode: '8P', version: 1 });
  assert.deepEqual(parseHeader(bytes), { title: 'POCKET DEMO', gameCode: 'APDJ', makerCode: '8P', version: 1 });
});

test('parseHeader trims trailing NULs and surrounding spaces', () => {
  const bytes = syntheticRom({ title: '  SPACED  \0\0', gameCode: 'AB\0\0' });
  const header = parseHeader(bytes);
  assert.equal(header.title, 'SPACED');
  assert.equal(header.gameCode, 'AB');
});

test('parseHeader uses the full 12-byte title and nothing beyond it', () => {
  const bytes = syntheticRom({ title: 'TWELVE CHARS' });
  assert.equal(parseHeader(bytes).title, 'TWELVE CHARS');
});

test('parseHeader is lenient on images shorter than the header', () => {
  assert.deepEqual(parseHeader(new Uint8Array(0)), { title: '', gameCode: '', makerCode: '', version: 0 });
  const partial = syntheticRom().subarray(0, 0xa4);
  assert.equal(parseHeader(partial).title, 'FIXT');
});
