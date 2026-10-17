import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeEndOf, compareCalls, makeReading, partsOf } from '../../../src/core/analysis/reading.ts';
import { readingOf, romWith } from '../../helpers/analysis.ts';

const E = 0x0800_0200;

test('lists are sorted once, pools keep walk order, calls the PoC order', () => {
  const rom = romWith([]);
  const r = readingOf(rom, {
    entry: E,
    insns: [
      { addr: E + 4, len: 2 },
      { addr: E, len: 4 },
      { addr: E + 4, len: 2 },
    ],
    pools: [
      { addr: E + 0x10, value: 1 },
      { addr: E + 0x8, value: 2 },
      { addr: E + 0x10, value: 9 },
    ],
    calls: [
      { site: E + 2, target: 0x0800_0400, mode: 'thumb' },
      { site: E, target: 0x0800_0400, mode: 'arm' },
      { site: E, target: 0x0800_0300, mode: 'thumb' },
      { site: E + 2, target: 0x0800_0400, mode: 'thumb' },
    ],
    veneers: [3, 1, 3],
    end: E + 0x14,
  });
  assert.deepEqual(r.insns, [{ addr: E, len: 4 }, { addr: E + 4, len: 2 }]);
  assert.equal(r.insnAt.get(E + 4), 2);
  assert.deepEqual(r.pools, [{ addr: E + 0x10, value: 1 }, { addr: E + 0x8, value: 2 }]);
  assert.equal(r.poolAt.get(E + 0x10), 1, 'the first load keeps its value');
  assert.deepEqual(r.calls.map((c) => `${c.target.toString(16)}:${c.mode}:${c.site - E}`), ['8000300:thumb:0', '8000400:arm:0', '8000400:thumb:2']);
  assert.deepEqual(r.veneers, [1, 3]);
  assert.equal(r.codeEnd, E + 6);
  assert.equal(r.end, E + 0x14);
  assert.ok(compareCalls({ site: 0, target: 1, mode: 'arm' }, { site: 0, target: 1, mode: 'thumb' }) < 0);
  assert.equal(codeEndOf(E, []), E);
});

test("holes follow the PoC's dense(): zero padding before covered bytes is not a hole", () => {
  // code at E..E+4, zero halfword at E+4, pool at E+8: the halfword at E+6 is zero but its next is the pool.
  const bytes = new Uint8Array(0x20);
  bytes.set([0x01, 0x48, 0x70, 0x47, 0x00, 0x00, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12], 0);
  bytes.set([0xff, 0xff], 0x0c);
  const rom = romWith([{ at: E, bytes }]);
  const tight = readingOf(rom, { entry: E, insns: [{ addr: E, len: 2 }, { addr: E + 2, len: 2 }], pools: [{ addr: E + 8, value: 0x12345678 }], end: E + 12 });
  assert.equal(tight.holeBytes, 2, 'E+4 is zero but E+6 is not covered; E+6 is zero and E+8 is covered');
  assert.deepEqual(tight.holes, [{ start: E + 4, end: E + 6 }]);
  const wide = readingOf(rom, { entry: E, insns: [{ addr: E, len: 2 }], end: E + 0x10 });
  assert.equal(wide.holeBytes, 0x10 - 2 - 2, 'every uncovered halfword but the last zero one before the end');
});

test('partsOf rebuilds the same reading', () => {
  const rom = romWith([]);
  const r = readingOf(rom, { entry: E, insns: [{ addr: E, len: 2 }], far: [5, 4], blVerdicts: [{ site: 9, target: 1, verdict: 'far', rule: 'bl.near-is-call' }, { site: 3, target: 1, verdict: 'call', rule: 'bl.near-is-call' }] });
  assert.deepEqual(r.far, [4, 5]);
  assert.deepEqual(r.blVerdicts.map((v) => v.site), [3, 9]);
  assert.deepEqual(makeReading(partsOf(r), rom), r);
});
