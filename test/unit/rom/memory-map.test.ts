import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEMORY_REGIONS, isRamAddress, isRomAddress, regionOf } from '../../../src/foundation/rom/memory-map.ts';

test('the regions are in address order and do not overlap', () => {
  for (let i = 1; i < MEMORY_REGIONS.length; i++) {
    const before = MEMORY_REGIONS[i - 1];
    const region = MEMORY_REGIONS[i];
    assert.ok(before !== undefined && region !== undefined);
    assert.ok(before.start + before.size <= region.start, `${before.name} overlaps ${region.name}`);
  }
});

test('regionOf finds the region at its first and last byte, and nothing in the gaps', () => {
  assert.equal(regionOf(0x0000_0000)?.name, 'bios');
  assert.equal(regionOf(0x0000_3fff)?.name, 'bios');
  assert.equal(regionOf(0x0000_4000), undefined);
  assert.equal(regionOf(0x0200_0000)?.name, 'ewram');
  assert.equal(regionOf(0x0203_ffff)?.name, 'ewram');
  assert.equal(regionOf(0x0204_0000), undefined);
  assert.equal(regionOf(0x0300_7fff)?.name, 'iwram');
  assert.equal(regionOf(0x0400_0200)?.name, 'io');
  assert.equal(regionOf(0x0500_0000)?.name, 'palette');
  assert.equal(regionOf(0x0601_7fff)?.name, 'vram');
  assert.equal(regionOf(0x0700_03ff)?.name, 'oam');
  assert.equal(regionOf(0x0800_0000)?.name, 'rom');
  assert.equal(regionOf(0x0dff_ffff)?.name, 'rom');
  assert.equal(regionOf(0x0e00_ffff)?.name, 'sram');
  assert.equal(regionOf(0x0e01_0000), undefined);
  assert.equal(regionOf(0xffff_ffff), undefined);
});

test('isRomAddress covers the three wait-state mirrors', () => {
  assert.equal(isRomAddress(0x0800_0000), true);
  assert.equal(isRomAddress(0x0a00_0000), true);
  assert.equal(isRomAddress(0x0c00_0000), true);
  assert.equal(isRomAddress(0x07ff_ffff), false);
  assert.equal(isRomAddress(0x0e00_0000), false);
});

test('isRamAddress is EWRAM and IWRAM only', () => {
  assert.equal(isRamAddress(0x0200_0000), true);
  assert.equal(isRamAddress(0x0300_7ffc), true);
  assert.equal(isRamAddress(0x0600_0000), false);
  assert.equal(isRamAddress(0x0800_0000), false);
});
