import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressMap, toLoad, toRun } from '../../../../src/core/analysis/address-map.ts';

test('phase 2 builds the identity, with or without overrides', () => {
  for (const m of [addressMap([]), addressMap([{ span: { start: 0x0800_1000, end: 0x0800_2000 }, kind: 'code', mode: 'arm' }])]) {
    assert.deepEqual(m.ranges, []);
    for (const a of [0x0800_0000, 0x0800_1234, 0x09ff_fffe]) {
      assert.equal(toRun(m, a), a);
      assert.equal(toLoad(m, a), a);
    }
  }
});

test('a run address outside the cartridge has no load address (a RAM reference)', () => {
  const m = addressMap([]);
  assert.equal(toLoad(m, 0x0300_0388), undefined);
  assert.equal(toLoad(m, 0x0a00_0000), undefined);
});

test('a filled map translates inside its ranges only', () => {
  const m = { ranges: [{ load: { start: 0x0804_f318, end: 0x0804_f418 }, run: 0x0300_0388 }] };
  assert.equal(toRun(m, 0x0804_f31c), 0x0300_038c);
  assert.equal(toRun(m, 0x0804_f418), 0x0804_f418);
  assert.equal(toLoad(m, 0x0300_038c), 0x0804_f31c);
  assert.equal(toLoad(m, 0x0300_0488), undefined);
});
