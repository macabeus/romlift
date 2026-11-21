// Property: the walker with the registered walk rules reads every random program exactly as it reads it
// with the reference policies of test/helpers/analysis.ts (the PoC's analyzeThumb/analyzeArm decisions
// that stood in for these rules), in both modes, under random function sets and code claims. The
// programs are drawn from the encodings each rule decides: pool loads, branches, bl, bx, writes to pc,
// pushes and pops, swi, zero padding and undecodable halfwords.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { Mode } from '../../../../../src/foundation/rom/span.ts';
import { REFERENCE_WALK, romWith, viewWith, walkReading } from '../../../../helpers/analysis.ts';
import { prngSequence } from '../../../../helpers/prng.ts';
import { WALK } from './support.ts';

const F = 0x0800_0200;
const SIZE = 0x80;

type Next = (n: number) => number;

function thumbHalfwords(next: Next): number[] {
  const off = next(33) - 16;
  switch (next(20)) {
    case 0:
      return [0x4800 | next(16)];
    case 1:
      return [0xe000 | (off & 0x7ff)];
    case 2:
      return [0xd000 | (next(14) << 8) | (off & 0xff)];
    case 3: {
      const d = (next(2) === 0 ? off * 2 : 0x800 + 2 * next(0x100)) >> 1;
      return [0xf000 | ((d >> 11) & 0x7ff), 0xf800 | (d & 0x7ff)];
    }
    case 4:
      return [0x4700 | (next(2) << 3)];
    case 5:
      return [0x4770];
    case 6:
      return [0x4778];
    case 7:
      return [0x4687];
    case 8:
      return [0x4487];
    case 9:
      return [0xb500 | next(0x100)];
    case 10:
      return [0xbd00 | next(0x100)];
    case 11:
      return [0xdf00 | next(4)];
    case 12:
    case 13:
      return [0];
    case 14:
      return [0xb100];
    case 15:
      return [0x46c0];
    default:
      return [0x2000 | next(0x100)];
  }
}

function armWord(next: Next): number {
  const off = (next(33) - 16) & 0xff_ffff;
  const words = [
    0xe1a0e00f,
    0xe12fff11,
    0xe12fff1e,
    0x112fff11,
    0xe1a0f000,
    0xe590f000,
    0xe59f0000 | (4 * next(16)),
    0xea000000 | off,
    0x0a000000 | off,
    0xeb000000 | off,
    0xe1a00000,
    0xe8908010,
    0xef000000,
    0xf0000000,
    0xe3a00001,
  ];
  return words[next(words.length)] ?? 0;
}

function program(mode: Mode, next: Next): Uint8Array {
  const out = new Uint8Array(SIZE);
  const view = new DataView(out.buffer);
  for (let a = 0; a < SIZE; ) {
    if (next(6) === 0 && a % 4 === 0 && a + 4 <= SIZE) {
      view.setUint32(a, [F + 2 * next(SIZE / 2), F + 1 + 2 * next(SIZE / 2), 0, F + 0x40][next(4)] ?? 0, true);
      a += 4;
    } else if (mode === 'arm') {
      if (a + 4 > SIZE) break;
      view.setUint32(a, armWord(next), true);
      a += 4;
    } else {
      for (const hw of thumbHalfwords(next))
        if (a + 2 <= SIZE) {
          view.setUint16(a, hw, true);
          a += 2;
        }
    }
  }
  return out;
}

test('the registered walk rules read 2,000 random programs as the reference policies do', () => {
  const r = prngSequence(0x5a1c, 2_000_000);
  let k = 0;
  const next: Next = (n) => (r[k++] ?? 0) % n;
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const mode: Mode = i % 2 === 0 ? 'thumb' : 'arm';
    const rom = romWith([{ at: F, bytes: program(mode, next) }]);
    const step = mode === 'arm' ? 4 : 2;
    const functions = Array.from({ length: next(3) }, () => F + step * (1 + next(SIZE / step - 1)));
    const start = F + step * next(SIZE / step);
    const claims = next(2) === 0 ? [] : [{ span: { start, end: start + 8 }, kind: Claim.code }];
    const v = viewWith({ rom, functions, claims });
    const got = walkReading(v, F, mode, WALK);
    const want = walkReading(v, F, mode, REFERENCE_WALK);
    assert.deepEqual(got, want, `program ${i} (${mode})`);
    for (const e of got.exits) seen.add(e.rule);
    if (got.tables.length > 0) seen.add('tables');
    if (got.deadEnd.length > 0) seen.add('dead-ends');
    if (got.pools.length > 0) seen.add('pools');
    if (got.veneers.length > 0) seen.add('veneers');
  }
  const decided = [
    'walk.branch-into-function',
    'walk.mov-pc-without-table',
    'walk.bx-pc-veneer',
    'walk.noreturn-call-before-noncode',
    'walk.swi-before-noncode',
    'dead-ends',
    'pools',
    'veneers',
  ];
  assert.deepEqual(
    decided.filter((d) => !seen.has(d)),
    [],
    'the programs exercise every exit the rules decide',
  );
});
