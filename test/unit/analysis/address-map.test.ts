// The address map (architecture §3.3, §6.7, D46, D91): the identity without a runs_at override; one range per
// override with runsAt, sorted, disjoint (a range overlapping an earlier one in load or run space is left out, the model
// refusing such a config); toRun and toLoad inside and outside the ranges; a run address no cartridge byte runs at is a
// RAM reference; and the load-space image of the ROM a jump-table idiom reads inside a range.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addressMap, loadSpaceImage, rangeAtLoad, runsElsewhere, toLoad, toRun } from '../../../src/core/analysis/address-map.ts';
import type { OverrideFact } from '../../../src/core/analysis/types.ts';
import { u32 } from '../../../src/foundation/rom/rom.ts';
import { romWith, words } from '../../helpers/analysis.ts';

const KLONOA: OverrideFact = { span: { start: 0x0804_f318, end: 0x0804_f6bc }, kind: 'code', mode: 'thumb', runsAt: 0x0300_0388 };

test('the identity without a runs_at override, whatever other overrides say', () => {
  for (const m of [addressMap([]), addressMap([{ span: { start: 0x0800_1000, end: 0x0800_2000 }, kind: 'code', mode: 'arm' }, { span: { start: 0x0800_3000, end: 0x0800_3100 }, kind: 'data' }])]) {
    assert.deepEqual(m.ranges, []);
    for (const a of [0x0800_0000, 0x0800_1234, 0x09ff_fffe]) {
      assert.equal(toRun(m, a), a);
      assert.equal(toLoad(m, a), a);
      assert.equal(runsElsewhere(m, a), false);
    }
  }
});

test('a run address outside the cartridge and every range has no load address (a RAM reference)', () => {
  for (const m of [addressMap([]), addressMap([KLONOA])]) {
    assert.equal(toLoad(m, 0x0300_0000), undefined);
    assert.equal(toLoad(m, 0x0300_0800), undefined, 'past the range in RAM');
    assert.equal(toLoad(m, 0x0a00_0000), undefined);
  }
});

test("Klonoa's SoundMainRAM range: load span to run address, both directions, its ends exclusive", () => {
  const m = addressMap([KLONOA]);
  assert.deepEqual(m.ranges, [{ load: { start: 0x0804_f318, end: 0x0804_f6bc }, run: 0x0300_0388 }]);
  assert.equal(toRun(m, 0x0804_f318), 0x0300_0388);
  assert.equal(toRun(m, 0x0804_f6b8), 0x0300_0728);
  assert.equal(toRun(m, 0x0804_f6bc), 0x0804_f6bc, 'the end runs where it is loaded');
  assert.equal(toRun(m, 0x0804_f314), 0x0804_f314);
  assert.equal(toLoad(m, 0x0300_0389), 0x0804_f319, 'a Thumb pointer keeps its bit');
  assert.equal(toLoad(m, 0x0300_072b), 0x0804_f6bb);
  assert.equal(toLoad(m, 0x0300_072c), undefined, 'one past the run span is RAM');
  assert.equal(toLoad(m, 0x0804_f318), 0x0804_f318, 'a cartridge address is its own load address, even inside the load span');
  assert.equal(runsElsewhere(m, 0x0804_f318), true);
  assert.equal(runsElsewhere(m, 0x0804_f6bc), false);
  assert.equal(rangeAtLoad(m, 0x0804_f400)?.run, 0x0300_0388);
});

test('ranges are sorted; one overlapping an earlier range in load or run space, or no range at all, is left out', () => {
  const a: OverrideFact = { span: { start: 0x0800_2000, end: 0x0800_2100 }, kind: 'code', runsAt: 0x0300_0000 };
  const b: OverrideFact = { span: { start: 0x0800_1000, end: 0x0800_1100 }, kind: 'code', runsAt: 0x0300_1000 };
  const loadOverlap: OverrideFact = { span: { start: 0x0800_20f0, end: 0x0800_2200 }, kind: 'code', runsAt: 0x0300_4000 };
  const runOverlap: OverrideFact = { span: { start: 0x0800_3000, end: 0x0800_3100 }, kind: 'code', runsAt: 0x0300_00f0 };
  const empty: OverrideFact = { span: { start: 0x0800_4000, end: 0x0800_4000 }, kind: 'code', runsAt: 0x0300_6000 };
  const nan: OverrideFact = { span: { start: Number.NaN, end: 0x0800_5000 }, kind: 'code', runsAt: 0x0300_7000 };
  const m = addressMap([a, loadOverlap, b, runOverlap, empty, nan]);
  assert.deepEqual(
    m.ranges.map((r) => [r.load.start, r.run]),
    [
      [0x0800_1000, 0x0300_1000],
      [0x0800_2000, 0x0300_0000],
    ],
  );
  assert.equal(toLoad(m, 0x0300_00f8), 0x0800_20f8, 'the first range keeps its run span');
  assert.deepEqual(addressMap([loadOverlap, a]).ranges.map((r) => r.load.start), [0x0800_2000], 'by load start, whatever the order given');
});

test('loadSpaceImage: inside a range, each aligned word naming a run address of it holds its load address; nothing else changes; never a Rom (architecture-9)', () => {
  const L = 0x0800_0400;
  const R = 0x0300_0000;
  const rom = romWith([
    { at: L, bytes: words(R + 0x10, 0x0300_0200, 0x1234_5678, R + 0x21) },
    { at: L + 0x100, bytes: words(R + 0x10) },
  ], { size: 0x800 });
  const m = addressMap([{ span: { start: L, end: L + 0x100 }, kind: 'code', runsAt: R }]);
  const image = loadSpaceImage(m, rom);
  assert.deepEqual([0, 4, 8, 12].map((k) => u32(image, L + k)), [L + 0x10, 0x0300_0200, 0x1234_5678, L + 0x21]);
  assert.equal(u32(image, L + 0x100), R + 0x10, "a word outside the range is the ROM's own");
  assert.equal(u32(rom, L), R + 0x10, 'the ROM itself is not changed');
  assert.equal(loadSpaceImage(m, rom), image, 'built once per map and ROM');
  assert.ok(!('sha1' in image) && !('header' in image), 'rewritten bytes carry no sha1 or header');
  assert.equal(loadSpaceImage(addressMap([]), rom).bytes, rom.bytes, "the ROM's own bytes on the identity map");
});
