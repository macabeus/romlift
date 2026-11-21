// Property: the reading's holes, computed over the uncovered stretches only, equal the PoC's dense()
// count over a byte array of the whole extent, for random instructions, pools, tables and bytes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeReading } from '../../../src/core/analysis/reading.ts';
import { romWith } from '../../helpers/analysis.ts';
import { prngSequence } from '../../helpers/prng.ts';

const A = 0x0800_0200;

/** romlift-poc/src/analysis.ts dense(), as a count. */
function pocHoles(
  bytes: Uint8Array,
  base: number,
  lo: number,
  hi: number,
  cover: readonly (readonly [number, number])[],
): number {
  const extent = hi - lo;
  const cov = new Uint8Array(Math.max(extent, 0));
  for (const [a, n] of cover) if (a >= lo && a + n <= hi) cov.fill(1, a - lo, a - lo + n);
  let holes = 0;
  for (let i = 0; i < extent; i += 2) {
    if (cov[i]) continue;
    const o = lo + i - base;
    const zero = ((bytes[o] ?? 0) | ((bytes[o + 1] ?? 0) << 8)) === 0;
    if (!(zero && (i + 2 >= extent || cov[i + 2]))) holes += 2;
  }
  return holes;
}

test('holes equal the PoC count on 3,000 random readings', () => {
  const r = prngSequence(0x5eed, 400_000);
  let k = 0;
  const next = (n: number): number => (r[k++] ?? 0) % n;
  const code = new Uint8Array(0x400);
  for (let i = 0; i < code.length; i++) code[i] = next(3) === 0 ? 0 : next(256);
  const rom = romWith([{ at: A, bytes: code }], { size: 0x800 });
  for (let t = 0; t < 3000; t++) {
    const entry = A + 2 * next(64);
    const insns = Array.from({ length: next(16) }, () => ({ addr: entry + 2 * next(100), len: next(2) === 0 ? 2 : 4 }));
    const pools = Array.from({ length: next(4) }, () => ({ addr: entry + next(200), value: 0 }));
    const tables = Array.from({ length: next(2) }, () => ({
      base: entry + next(200),
      targets: [0, 0, 0].slice(0, next(4)),
      thumbBit: false,
    }));
    const reading = makeReading(
      {
        entry,
        mode: 'thumb',
        insns,
        pools,
        tables,
        calls: [],
        blSites: [],
        deadEnd: [],
        balance: [],
        returns: 0,
        errors: [],
        veneers: [],
        adrs: [],
        tails: [],
        tailExits: 0,
        end: entry + next(200),
      },
      rom,
    );
    const cover = [
      ...reading.insns.map((i) => [i.addr, i.len] as const),
      ...reading.pools.map((p) => [p.addr, 4] as const),
      ...reading.tables.map((tb) => [tb.base, 4 * tb.targets.length] as const),
    ];
    assert.equal(reading.holeBytes, pocHoles(rom.bytes, rom.base, reading.entry, reading.end, cover), `reading ${t}`);
    assert.equal(reading.holes.reduce((n, h) => n + (h.end - h.start), 0) <= reading.holeBytes, true);
  }
});
