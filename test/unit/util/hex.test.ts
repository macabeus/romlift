import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hex, hexAddr, parseHexAddr } from '../../../src/foundation/util/hex.ts';

test('hex pads to eight upper-case digits by default', () => {
  assert.equal(hex(0), '00000000');
  assert.equal(hex(0x0800_00ab), '080000AB');
  assert.equal(hex(0xff, 2), 'FF');
  assert.equal(hex(0x1234, 2), '1234', 'never truncates');
});

test('hex reads values at and above 2^31 as unsigned', () => {
  assert.equal(hex(0x8000_0000), '80000000');
  assert.equal(hex(0xffff_ffff), 'FFFFFFFF');
  assert.equal(hex(-1), 'FFFFFFFF');
  assert.equal(hex(0x0a00_0000 | 0x8000_0000), '8A000000');
});

test('hexAddr adds the 0x prefix', () => {
  assert.equal(hexAddr(0x0800_0000), '0x08000000');
  assert.equal(hexAddr(0xe000_0000), '0xE0000000');
});

test('parseHexAddr accepts 0x and one to eight digits, nothing else', () => {
  assert.equal(parseHexAddr('0x8000000'), 0x0800_0000);
  assert.equal(parseHexAddr('0x08000000'), 0x0800_0000);
  assert.equal(parseHexAddr('0xffffffff'), 0xffff_ffff);
  assert.equal(parseHexAddr('0X1a'), 0x1a);
  assert.equal(parseHexAddr('0x0'), 0);
  for (const bad of ['', '0x', '08000000', '0x123456789', '0x12g', ' 0x10', '0x10 ', '-0x10', '0x+1']) {
    assert.equal(parseHexAddr(bad), undefined, bad);
  }
  assert.equal(parseHexAddr(hexAddr(0xdead_beef)), 0xdead_beef);
});
