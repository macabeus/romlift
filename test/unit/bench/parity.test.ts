// romlift's parity view (bench/src/parity.ts): a hand-built AnalysisResult gives exactly a hand-written
// ParityView: pools and far pools merged, tables as [base, count], far and noreturn sites from the bl
// verdicts, claims merged across the extent splits with padding and data dropped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnalysisResult, FunctionFact } from 'romlift';

import { PARITY_SCHEMA, type ParityView, parityDigest, parseParityView } from '../../../bench/src/parity-view.ts';
import { parityViewOf, resultParityDigest } from '../../../bench/src/parity.ts';

const base: Omit<FunctionFact, 'entry' | 'mode' | 'extent' | 'codeEnd' | 'code' | 'origin'> = {
  dead: [],
  pools: [],
  farPools: [],
  tables: [],
  calls: [],
  blVerdicts: [],
  exits: [],
  branchTargets: [],
  adrs: [],
  veneers: [],
  absorbed: [],
  holes: [],
  accepted: { rule: 'seed.rom-entry', round: 0, cites: [] },
  also: [],
};

const arm: FunctionFact = {
  ...base,
  entry: 0x0800_0000,
  mode: 'arm',
  extent: { start: 0x0800_0000, end: 0x0800_0010 },
  codeEnd: 0x0800_000c,
  code: [{ start: 0x0800_0000, end: 0x0800_000c }],
  pools: [0x0800_000c],
  origin: 'rom-entry',
};

const thumb: FunctionFact = {
  ...base,
  entry: 0x0800_0010,
  mode: 'thumb',
  extent: { start: 0x0800_0010, end: 0x0800_0040 },
  codeEnd: 0x0800_0030,
  // An absorbed block's instructions are already part of the code runs; touching runs merge.
  code: [
    { start: 0x0800_0010, end: 0x0800_0018 },
    { start: 0x0800_0018, end: 0x0800_0020 },
    { start: 0x0800_0024, end: 0x0800_0030 },
  ],
  absorbed: [{ start: 0x0800_0024, end: 0x0800_0030 }],
  pools: [0x0800_0034, 0x0800_0030],
  farPools: [0x0800_1000],
  tables: [{ base: 0x0800_0038, targets: [0x0800_0012, 0x0800_0016], thumbBit: false }],
  blVerdicts: [
    { site: 0x0800_0018, target: 0x0800_2000, verdict: 'noreturn', rule: 'bl.noreturn-before-noncode' },
    { site: 0x0800_0010, target: 0x0800_0400, verdict: 'call', rule: 'bl.near-is-call' },
    { site: 0x0800_0014, target: 0x0800_3000, verdict: 'far', rule: 'bl.target-inside-caller' },
  ],
  origin: 'gap-scan',
};

const result: AnalysisResult = {
  schema: 'romlift/analysis@1',
  mode: 'discover',
  rom: { sha1: '0'.repeat(40), end: 0x0800_4000 },
  profile: 'agbcc',
  options: { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
  functions: [thumb, arm],
  claims: [
    { span: { start: 0x0800_0000, end: 0x0800_000c }, kind: 1, owner: 0x0800_0000 },
    { span: { start: 0x0800_000c, end: 0x0800_0010 }, kind: 2, owner: 0x0800_0000 },
    // Split at the extent boundary: one run in the view.
    { span: { start: 0x0800_0010, end: 0x0800_0018 }, kind: 1, owner: 0x0800_0010 },
    { span: { start: 0x0800_0018, end: 0x0800_0020 }, kind: 1, owner: 0x0800_0010 },
    { span: { start: 0x0800_0020, end: 0x0800_0024 }, kind: 4, owner: 0x0800_0010 },
    { span: { start: 0x0800_0024, end: 0x0800_0030 }, kind: 1, owner: 0x0800_0010 },
    { span: { start: 0x0800_0030, end: 0x0800_0038 }, kind: 2, owner: 0x0800_0010 },
    { span: { start: 0x0800_0038, end: 0x0800_0040 }, kind: 3, owner: 0x0800_0010 },
    { span: { start: 0x0800_0040, end: 0x0800_0044 }, kind: 5 },
    { span: { start: 0x0800_1000, end: 0x0800_1004 }, kind: 2 },
    { span: { start: 0x0800_1004, end: 0x0800_1100 }, kind: 6 },
  ],
  startup: { span: { start: 0x0800_0000, end: 0x0800_0010 }, entries: [0x0800_0000] },
  codeEnd: 0x0800_0040,
  rejections: [],
  diagnostics: [],
};

const expected: ParityView = {
  schema: PARITY_SCHEMA,
  functions: [
    {
      entry: 0x0800_0000,
      mode: 'arm',
      end: 0x0800_0010,
      codeEnd: 0x0800_000c,
      code: [[0x0800_0000, 0x0800_000c]],
      pools: [0x0800_000c],
      tables: [],
      far: [],
      noreturn: [],
      origin: 'rom-entry',
    },
    {
      entry: 0x0800_0010,
      mode: 'thumb',
      end: 0x0800_0040,
      codeEnd: 0x0800_0030,
      code: [
        [0x0800_0010, 0x0800_0020],
        [0x0800_0024, 0x0800_0030],
      ],
      pools: [0x0800_0030, 0x0800_0034, 0x0800_1000],
      tables: [[0x0800_0038, 2]],
      far: [0x0800_0014],
      noreturn: [0x0800_0018],
      origin: 'gap-scan',
    },
  ],
  claims: [
    [0x0800_0000, 0x0800_000c, 1],
    [0x0800_000c, 0x0800_0010, 2],
    [0x0800_0010, 0x0800_0020, 1],
    [0x0800_0020, 0x0800_0024, 4],
    [0x0800_0024, 0x0800_0030, 1],
    [0x0800_0030, 0x0800_0038, 2],
    [0x0800_0038, 0x0800_0040, 3],
    [0x0800_1000, 0x0800_1004, 2],
  ],
  startup: { end: 0x0800_0010, entries: [0x0800_0000] },
  codeEnd: 0x0800_0040,
};

test('the parity view of a hand-built result is the hand-written view', () => {
  const view = parityViewOf(result);
  assert.deepStrictEqual(view, expected);
  assert.deepStrictEqual(parseParityView(view, 'view'), expected, 'the view is as frozen: sorted, maximal runs');
});

test('padding and data claims are left out; far and noreturn come from the bl verdicts', () => {
  const view = parityViewOf(result);
  assert.ok(view.claims.every(([, , kind]) => kind >= 1 && kind <= 4));
  const t = view.functions[1];
  assert.deepEqual([t?.far, t?.noreturn], [[0x0800_0014], [0x0800_0018]]);
});

test('the result digest is the parity digest of the view', () => {
  assert.equal(resultParityDigest(result), parityDigest(expected));
  const moved: AnalysisResult = {
    ...result,
    functions: [{ ...thumb, extent: { start: 0x0800_0010, end: 0x0800_0044 } }, arm],
  };
  assert.notEqual(resultParityDigest(moved), parityDigest(expected), 'an extent change changes the digest');
});
