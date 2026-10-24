// The default spellings and their one parser (foundation/util/project-files.ts, architecture-r1-2): sub_, unk_, _ and
// gUnk_ with eight upper-case hex digits, read back by isDefaultSpelling and defaultSpellingAddress.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dataName, defaultFunctionName, defaultSpellingAddress, isDefaultSpelling, localName, orphanName } from '../../../src/foundation/util/project-files.ts';

test('the default spellings: sub_, unk_, _ and gUnk_ with eight upper-case hex digits', () => {
  assert.equal(defaultFunctionName(0x0800_00ab), 'sub_080000AB');
  assert.equal(orphanName(0x0800_00ab), 'unk_080000AB');
  assert.equal(localName(0x0800_00ab), '_080000AB');
  assert.equal(dataName(0x0300_0010), 'gUnk_03000010');
  for (const name of ['sub_080000AB', 'unk_080000AB', '_080000AB', 'gUnk_03000010']) assert.ok(isDefaultSpelling(name), name);
  for (const name of ['sub_080000ab', 'Main', 'sub_0800AB', 'r0']) assert.ok(!isDefaultSpelling(name), name);
});

test('the parser reads back every spelling the module writes, and nothing else', () => {
  const addr = 0x0812_3abc;
  for (const spell of [defaultFunctionName, orphanName, localName, dataName]) {
    const name = spell(addr);
    assert.ok(isDefaultSpelling(name), name);
    assert.equal(defaultSpellingAddress(name), addr, name);
  }
  assert.equal(defaultSpellingAddress('Main'), undefined);
  assert.equal(defaultSpellingAddress('sub_0812abc'), undefined);
});
