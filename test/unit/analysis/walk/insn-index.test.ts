// The walk's instruction index (core/analysis/walk/insn-index.ts): lengths by address in 4 KiB pages,
// with the Map operations a walk and Reading.insnAt use.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InsnIndex } from '../../../../src/core/analysis/walk/insn-index.ts';

test('set, get, has and delete agree with a Map across pages, and size counts present addresses', () => {
  const index = new InsnIndex();
  const map = new Map<number, number>();
  const addrs = [0x0800_0000, 0x0800_0002, 0x0800_0ffe, 0x0800_1000, 0x0800_7000, 0x0900_0004, 0x0800_0002];
  for (const [i, a] of addrs.entries()) {
    const len = i % 2 === 0 ? 2 : 4;
    index.set(a, len);
    map.set(a, len);
  }
  assert.equal(index.size, map.size);
  for (const a of [...addrs, 0x0800_0004, 0x0800_1002, 0x0a00_0000]) {
    assert.equal(index.has(a), map.has(a), `has ${a.toString(16)}`);
    assert.equal(index.get(a), map.get(a), `get ${a.toString(16)}`);
  }
  index.delete(0x0800_1000);
  index.delete(0x0800_1000);
  index.delete(0x0b00_0000);
  assert.equal(index.has(0x0800_1000), false);
  assert.equal(index.size, map.size - 1);
});
