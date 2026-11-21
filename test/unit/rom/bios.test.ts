// The BIOS copy calls as data (src/foundation/rom/bios.ts, GBATEK "BIOS Memory Copy").
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BIOS_COPY_ARGS,
  BIOS_CPU_FAST_SET,
  BIOS_CPU_SET,
  biosCopyBytes,
  isBiosCopy,
} from '../../../src/foundation/rom/bios.ts';

test('CpuSet copies halfwords, or words with bit 26', () => {
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 8), 16);
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 0x0400_0008), 32);
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 7), 14, 'no rounding');
});

test('CpuFastSet copies words in blocks of 8, its count rounded up', () => {
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 8), 32);
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 2), 32);
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 10), 64);
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 0x0400_0010), 64, 'bit 26 changes nothing: always words');
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 0), 0);
});

test('a fill copies nothing; the count is bits 0-20; another swi is no copy', () => {
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 0x0100_0008), undefined);
  assert.equal(biosCopyBytes(BIOS_CPU_FAST_SET, 0x0100_0008), undefined);
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 0x0020_0004), 8, 'bit 21 is not part of the count');
  assert.equal(biosCopyBytes(BIOS_CPU_SET, 0x001f_ffff), 0x1f_ffff * 2);
  for (const swi of [0x00, 0x0a, 0x0d, 0x11, 0xff]) {
    assert.equal(isBiosCopy(swi), false);
    assert.equal(biosCopyBytes(swi, 8), undefined);
  }
  assert.equal(isBiosCopy(BIOS_CPU_SET), true);
  assert.equal(isBiosCopy(BIOS_CPU_FAST_SET), true);
  assert.deepEqual(BIOS_COPY_ARGS, { source: 0, dest: 1, control: 2 });
});
