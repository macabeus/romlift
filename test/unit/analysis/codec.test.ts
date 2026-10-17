// The analysis codec (core/analysis/codec.ts): a lossless round trip of hand-built discover and confirm
// results, a canonical encoding whatever the key order in memory, hex addresses, and a diagnostic
// naming the first member a malformed document gets wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';

import { decodeAnalysis, encodeAnalysis } from '../../../src/core/analysis/codec.ts';
import type { AnalysisResult, FunctionFact } from '../../../src/core/analysis/types.ts';

const A = 0x0800_0200;

const fact: FunctionFact = {
  entry: A,
  mode: 'thumb',
  extent: { start: A, end: A + 0x40 },
  codeEnd: A + 0x38,
  code: [{ start: A, end: A + 0x30 }, { start: A + 0x34, end: A + 0x38 }],
  dead: [{ start: A + 0x30, end: A + 0x34 }],
  pools: [A + 0x38, A + 0x3c],
  farPools: [0x0800_1000],
  tables: [{ base: A + 0x20, targets: [A + 0x8, A + 0x10], thumbBit: false }],
  calls: [{ site: A + 4, target: 0x0800_0400, mode: 'thumb' }],
  blVerdicts: [
    { site: A + 4, target: 0x0800_0400, verdict: 'call', rule: 'bl.near-is-call' },
    { site: A + 8, target: 0x0800_2000, verdict: 'far', rule: 'bl.target-inside-caller' },
  ],
  exits: [{ at: A + 0x2e, rule: 'walk.decoder-flow', kind: 'return' }],
  branchTargets: [A + 0x10],
  adrs: [],
  veneers: [],
  absorbed: [{ start: A + 0x30, end: A + 0x34 }],
  holes: [],
  origin: 'call',
  accepted: { rule: 'seed.call', round: 0, cites: [0x0800_0100] },
  also: [{ rule: 'seed.pool-pointer', round: 2, cites: [A], note: 'again' }],
};

const arm: FunctionFact = {
  ...fact,
  entry: 0x0800_0000,
  mode: 'arm',
  runAt: 0x0300_0000,
  extent: { start: 0x0800_0000, end: 0x0800_00c0 },
  codeEnd: 0x0800_00c0,
  code: [{ start: 0x0800_0000, end: 0x0800_00c0 }],
  dead: [],
  pools: [],
  farPools: [],
  tables: [],
  calls: [],
  blVerdicts: [],
  exits: [],
  branchTargets: [],
  absorbed: [],
  holes: [{ start: 0x0800_0004, end: 0x0800_00c0 }],
  origin: 'rom-entry',
  accepted: { rule: 'seed.rom-entry', round: 0, cites: [] },
  also: [],
};

const discover: AnalysisResult = {
  schema: 'romlift/analysis@1',
  mode: 'discover',
  rom: { sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b', end: 0x0880_0000 },
  profile: 'agbcc',
  options: { mode: 'discover', seeds: [], overrides: [{ span: { start: A, end: A + 4 }, kind: 'data' }], trail: 'off' },
  functions: [arm, fact],
  claims: [
    { span: { start: 0x0800_0000, end: 0x0800_00c0 }, kind: 1, owner: 0x0800_0000 },
    { span: { start: A, end: A + 0x30 }, kind: 1, owner: A },
    { span: { start: 0x0800_1000, end: 0x0800_1004 }, kind: 2 },
    { span: { start: 0x0800_2000, end: 0x0800_2010 }, kind: 6 },
  ],
  startup: { span: { start: 0x0800_0000, end: 0x0800_00c0 }, entries: [0x0800_0000] },
  codeEnd: A + 0x40,
  rejections: [{ at: 0x0800_0300, mode: 'thumb', rule: 'valid.dense', reason: 'not-dense', intrinsic: true, round: 3, detail: 'holes', count: 2 }],
  diagnostics: [{ code: 'W_SETTLE_LIMIT', severity: 'warning', addr: A, message: 'did not settle', cites: [A], rule: 'bl.near-is-call' }],
};

const confirm: AnalysisResult = {
  ...discover,
  mode: 'confirm',
  options: {
    mode: 'confirm',
    seeds: [{ entry: A, mode: 'thumb', rule: 'seed.listed', name: 'Main', size: 0x40, label: false }],
    overrides: [{ span: { start: 0x0800_3000, end: 0x0800_3100 }, kind: 'code', mode: 'arm', runsAt: 0x0300_0000 }],
    trail: 'decisions',
    trailFilter: { start: A, end: A + 2 },
  },
  unlisted: [{ entry: 0x0800_0400, mode: 'thumb', origin: 'call', provenance: { rule: 'seed.call', round: 0, cites: [A + 4] } }],
  listedInvalid: [
    {
      entry: A,
      rejection: { at: A, mode: 'thumb', rule: 'valid.calls-code', reason: 'calls-non-code', intrinsic: false, round: 1, detail: 'calls 8000401', count: 1 },
    },
  ],
};

const textOf = (r: AnalysisResult): string => [...encodeAnalysis(r)].join('');

function decoded(source: string): AnalysisResult {
  const d = decodeAnalysis(source);
  if (!d.ok) assert.fail(d.diagnostics.map((x) => x.message).join('; '));
  return d.result;
}

/** The same value with every object's keys in reverse insertion order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) out[key] = reversed((value as Record<string, unknown>)[key]);
  return out;
}

test('a discover and a confirm result round-trip losslessly', () => {
  for (const r of [discover, confirm]) {
    const back = decoded(textOf(r));
    assert.deepStrictEqual(back, r);
    assert.equal(textOf(back), textOf(r), 'the encoding of the decoded result is the same text');
  }
});

test('an empty result round-trips, and optional members stay absent', () => {
  const empty: AnalysisResult = { ...discover, functions: [], claims: [], rejections: [], diagnostics: [], startup: { span: { start: 0x0800_0000, end: 0x0800_0000 }, entries: [] } };
  const back = decoded(textOf(empty));
  assert.deepStrictEqual(back, empty);
  assert.equal(Object.hasOwn(back.options, 'trailFilter'), false);
});

test('the encoding is canonical: sorted keys, hex addresses, independent of key order in memory', () => {
  const text = textOf(discover);
  assert.equal(textOf(reversed(discover) as AnalysisResult), text);
  assert.ok(text.startsWith('{"claims":['), text.slice(0, 40));
  assert.ok(text.includes('"entry":"0x08000200"'));
  assert.ok(text.includes('"round":2'), 'counts stay numbers');
  assert.ok(text.includes('"kind":6'), 'claim kinds stay numbers');
  assert.equal(JSON.stringify(JSON.parse(text)).length, text.length, 'no insignificant whitespace');
});

test('a malformed document is a diagnostic naming its first wrong member, never a throw', () => {
  const json = JSON.parse(textOf(discover)) as Record<string, unknown>;
  const cases: readonly [string, string][] = [
    ['{', 'not JSON'],
    [JSON.stringify({ ...json, schema: 'romlift/analysis@2' }), '$.schema'],
    [JSON.stringify({ ...json, mode: 'guess' }), '$.mode'],
    [JSON.stringify({ ...json, codeEnd: 134218304 }), '$.codeEnd'],
    [JSON.stringify({ ...json, extra: 1 }), '$.extra'],
    [JSON.stringify({ ...json, functions: [{ ...(json['functions'] as unknown[])[0] as object, origin: 'gap scan' }] }), '$.functions[0].origin'],
    [JSON.stringify({ ...json, rejections: [{ ...(json['rejections'] as unknown[])[0] as object, count: -1 }] }), '$.rejections[0].count'],
    [JSON.stringify((({ startup: _s, ...rest }) => rest)(json)), '$.startup'],
  ];
  for (const [source, where] of cases) {
    const d = decodeAnalysis(source);
    assert.equal(d.ok, false, where);
    if (d.ok) continue;
    assert.equal(d.diagnostics.length, 1);
    assert.equal(d.diagnostics[0]?.code, 'E_ANALYSIS_JSON');
    assert.equal(d.diagnostics[0]?.severity, 'error');
    assert.ok(d.diagnostics[0]?.message.includes(where), `${d.diagnostics[0]?.message} names ${where}`);
  }
});

test('the encoding streams in chunks whose concatenation is the whole text', () => {
  const many: AnalysisResult = { ...discover, functions: Array.from({ length: 2000 }, (_, i) => ({ ...fact, entry: A + 0x100 * i })) };
  const parts = [...encodeAnalysis(many)];
  assert.ok(parts.length > 1, 'a large result is more than one chunk');
  assert.deepStrictEqual(decoded(parts.join('')), many);
});

test('romlift exports the codec', () => {
  assert.equal(romlift.encodeAnalysis, encodeAnalysis);
  assert.equal(romlift.decodeAnalysis, decodeAnalysis);
  assert.equal(romlift.ANALYSIS_SCHEMA, 'romlift/analysis@1');
});
