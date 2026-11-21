import assert from 'node:assert/strict';
import { test } from 'node:test';

import callsCode from '../../../../../src/core/analysis/rules/valid/calls-code.ts';
import { Claim } from '../../../../../src/core/analysis/types.ts';
import type { AnalysisView, CallSite } from '../../../../../src/core/analysis/types.ts';
import type { Addr, Mode } from '../../../../../src/foundation/rom/span.ts';
import { readingOf, romWith, viewWith, words } from '../../../../helpers/analysis.ts';
import { thumbAt } from '../../../../helpers/thumb.ts';

const E = 0x0800_0200;
const GOOD = 0x0800_0300;
const ZERO = 0x0800_0310;
const ONES = 0x0800_0320;
const IN_POOL = 0x0800_0330;
const IN_TABLE = 0x0800_0340;
const BROKEN = 0x0800_0350;
const IN_CODE = 0x0800_0360;
const FUNC = 0x0800_0370;
const SIZE = 0x400;

const rom = romWith(
  [
    { at: GOOD, bytes: thumbAt(GOOD)`movs r0, #1; bx lr` },
    { at: ONES, bytes: words(0xffff_ffff) },
    { at: IN_POOL, bytes: thumbAt(IN_POOL)`bx lr; mov r8, r8` },
    { at: IN_TABLE, bytes: thumbAt(IN_TABLE)`bx lr; mov r8, r8` },
    { at: BROKEN, bytes: Uint8Array.of(0x01, 0x20, 0xfe, 0xde) },
    { at: IN_CODE, bytes: thumbAt(IN_CODE)`bx lr; mov r8, r8` },
    { at: FUNC, bytes: words(0) },
    { at: 0x0800_0000 + SIZE - 4, bytes: thumbAt(0x0800_0000 + SIZE - 4)`bx lr` },
  ],
  { size: SIZE },
);

function view(reads: Addr[] = []): AnalysisView {
  const base = viewWith({
    rom,
    functions: [FUNC],
    claims: [
      { span: { start: IN_POOL, end: IN_POOL + 4 }, kind: Claim.pool },
      { span: { start: IN_TABLE, end: IN_TABLE + 4 }, kind: Claim.table },
      { span: { start: IN_CODE, end: IN_CODE + 4 }, kind: Claim.code },
    ],
  });
  return { ...base, read: (entry: Addr, mode: Mode) => (reads.push(entry), base.read(entry, mode)) };
}

function check(targets: readonly (readonly [Addr, Mode])[], v: AnalysisView = view()): string | undefined {
  const calls: CallSite[] = targets.map(([target, mode], i) => ({ site: E + 4 * i, target, mode }));
  return callsCode.check(readingOf(rom, { entry: E, calls }), v);
}

test('callees that could be code, functions and ARM callees pass; only the rest are read', () => {
  const reads: Addr[] = [];
  assert.equal(
    check(
      [
        [GOOD, 'thumb'],
        [IN_CODE, 'thumb'],
        [FUNC, 'thumb'],
        [ZERO, 'arm'],
        [rom.end - 4, 'thumb'],
      ],
      view(reads),
    ),
    undefined,
  );
  assert.deepEqual(reads, [GOOD, IN_CODE, rom.end - 4]);
});

test('a callee in a pool or table, blank, undecodable, odd or without a word left is not code', () => {
  for (const t of [IN_POOL, IN_TABLE, ZERO, ONES, BROKEN, GOOD + 1, rom.end - 2]) {
    assert.equal(
      check([[t, 'thumb']]),
      `calls 0x${t.toString(16).toUpperCase().padStart(8, '0')}, which is not code`,
      t.toString(16),
    );
  }
});

test('the first failing callee in calls order is reported; the failure is not intrinsic', () => {
  assert.equal(
    check([
      [ONES, 'thumb'],
      [GOOD, 'thumb'],
      [ZERO, 'thumb'],
    ]),
    'calls 0x08000310, which is not code',
  );
  assert.equal(callsCode.reason, 'calls-non-code');
  assert.equal(callsCode.intrinsic, false);
});
