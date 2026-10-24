// The [[overrides]] without runs_at the analysis applies (correctness-b0-3, driver/seeds.ts): a `data` override claims
// its span from round 0, so no seed, call or gap scan takes an entry there, no walk enters it and no extent covers it;
// a `code` override builds a seed.override seed at its start in its mode, which adds a function nothing else finds
// (in confirm mode, an unlisted one is reported, not taken) and changes nothing over a function already found. On
// hand-made bytes under the agbcc profile.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyze } from '../../../../src/core/analysis/driver/run.ts';
import { dataOverrideSpans, outsideSpans, overrideSeeds } from '../../../../src/core/analysis/driver/seeds.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisOptions, AnalysisResult, OverrideFact, Seed } from '../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import { BASE, romWith } from '../../../helpers/analysis.ts';
import { armAt } from '../../../helpers/arm.ts';
import { thumbAt } from '../../../helpers/thumb.ts';

const INIT = BASE + 0xc0;
const CALLED = BASE + 0x100;
const LONG = BASE + 0x140;
const LONELY = BASE + 0x1a0;

/** The cartridge entry branches to INIT, which calls CALLED and LONG; LONELY is Thumb code nothing names. */
const ROM = romWith(
  [
    { at: INIT, bytes: armAt(INIT)`bl _08000100; bl _08000140; bx lr` },
    { at: CALLED, bytes: armAt(CALLED)`bx lr` },
    { at: LONG, bytes: armAt(LONG)`mov r0, #1; mov r1, #2; mov r2, #3; mov r3, #4; bx lr` },
    { at: LONELY, bytes: thumbAt(LONELY)`movs r0, #1; adds r0, #2; adds r0, #3; adds r0, #4; bx lr` },
  ],
  { entry: INIT, size: 0x400 },
);

/** Confirm mode lists what discover finds without overrides. */
const LISTED: readonly Seed[] = [BASE, INIT, CALLED, LONG].map((entry): Seed => ({ entry, mode: 'arm', rule: 'seed.listed' }));

function run(overrides: readonly OverrideFact[], mode: AnalysisOptions['mode'] = 'discover'): AnalysisResult {
  return analyze(ROM, AGBCC, { mode, seeds: mode === 'confirm' ? LISTED : [], overrides, trail: 'off' });
}

/** What the run decided of each function: entry, mode, extent, origin and accepting rule. */
const decided = (r: AnalysisResult): readonly unknown[] => r.functions.map((f) => [f.entry, f.mode, f.extent, f.origin, f.accepted.rule]);

const entries = (r: AnalysisResult): readonly number[] => r.functions.map((f) => f.entry);
const claimAt = (r: AnalysisResult, a: number): number | undefined => r.claims.find((c) => c.span.start <= a && a < c.span.end)?.kind;

test('without overrides the run finds the entry, INIT and its two callees, and not the lonely Thumb code', () => {
  const r = run([]);
  assert.deepEqual(entries(r), [BASE, INIT, CALLED, LONG]);
  assert.equal(r.functions.find((f) => f.entry === LONG)?.extent.end, LONG + 20);
});

test('a data override suppresses the function at its start: no accept, the span stays data, nothing else moves', () => {
  const r = run([{ span: { start: CALLED, end: CALLED + 4 }, kind: 'data' }]);
  assert.deepEqual(entries(r), [BASE, INIT, LONG]);
  assert.equal(claimAt(r, CALLED), Claim.data);
  assert.equal(claimAt(r, CALLED + 3), Claim.data);
});

test('a data override inside a function cuts it there: its code and extent end at the span, which no claim overwrites', () => {
  const r = run([{ span: { start: LONG + 8, end: LONG + 16 }, kind: 'data' }]);
  const f = r.functions.find((x) => x.entry === LONG);
  assert.ok(f !== undefined);
  assert.equal(f.extent.end, LONG + 8);
  assert.deepEqual(f.code, [{ start: LONG, end: LONG + 8 }]);
  for (const a of [LONG + 8, LONG + 12, LONG + 15]) assert.equal(claimAt(r, a), Claim.data, `0x${a.toString(16)}`);
  assert.equal(claimAt(r, LONG + 4), Claim.code);
});

test('a code override adds the function nothing else finds, at its start in its mode, with origin override', () => {
  const r = run([{ span: { start: LONELY, end: LONELY + 10 }, kind: 'code', mode: 'thumb' }]);
  const f = r.functions.find((x) => x.entry === LONELY);
  assert.ok(f !== undefined, `found ${entries(r).map((e) => e.toString(16)).join(', ')}`);
  assert.equal(f.mode, 'thumb');
  assert.equal(f.origin, 'override');
  assert.equal(f.accepted.rule, 'seed.override');
  assert.equal(f.extent.end, LONELY + 10);
  // A Thumb override names no mode: Thumb is the default.
  assert.equal(run([{ span: { start: LONELY, end: LONELY + 10 }, kind: 'code' }]).functions.find((x) => x.entry === LONELY)?.mode, 'thumb');
});

test('a code override over a function already found changes nothing; one off its mode\'s instruction grid builds no seed', () => {
  const plain = run([]);
  const over = run([{ span: { start: CALLED, end: CALLED + 4 }, kind: 'code', mode: 'arm' }]);
  assert.deepEqual(decided(over), decided(plain));
  assert.equal(over.functions.find((f) => f.entry === CALLED)?.origin, 'call');
  assert.deepEqual(over.claims, plain.claims);
  assert.deepEqual(overrideSeeds(ROM, [{ span: { start: LONELY + 1, end: LONELY + 9 }, kind: 'code' }, { span: { start: LONELY + 2, end: LONELY + 10 }, kind: 'code', mode: 'arm' }]), []);
  assert.deepEqual(decided(run([{ span: { start: LONELY + 1, end: LONELY + 9 }, kind: 'code' }])), decided(plain));
});

test('in confirm mode a code override at an unlisted start is reported unlisted from its seed, and taken nowhere', () => {
  const r = run([{ span: { start: LONELY, end: LONELY + 10 }, kind: 'code', mode: 'thumb' }], 'confirm');
  assert.equal(r.mode, 'confirm');
  assert.ok(!entries(r).includes(LONELY));
  assert.deepEqual(r.mode === 'confirm' ? r.unlisted.filter((u) => u.entry === LONELY).map((u) => [u.origin, u.provenance.rule]) : [], [['override', 'seed.override']]);
  assert.ok(r.diagnostics.some((d) => d.code === 'W_UNLISTED_FUNCTION' && d.addr === LONELY));
});

test('the overrides with runs_at are the address map\'s: they build no seed and claim nothing here', () => {
  const ram: OverrideFact[] = [
    { span: { start: LONELY, end: LONELY + 10 }, kind: 'code', mode: 'thumb', runsAt: 0x0300_0000 },
    { span: { start: CALLED, end: CALLED + 4 }, kind: 'data', runsAt: 0x0300_0100 },
  ];
  assert.deepEqual(overrideSeeds(ROM, ram), []);
  assert.deepEqual(dataOverrideSpans(ROM, ram), []);
});

test('dataOverrideSpans clips to the ROM and merges; outsideSpans leaves the parts around them', () => {
  const spans = dataOverrideSpans(ROM, [
    { span: { start: BASE + 0x3f0, end: BASE + 0x500 }, kind: 'data' },
    { span: { start: BASE + 0x110, end: BASE + 0x120 }, kind: 'data' },
    { span: { start: BASE + 0x118, end: BASE + 0x128 }, kind: 'data' },
    { span: { start: BASE + 0x128, end: BASE + 0x130 }, kind: 'data' },
    { span: { start: BASE + 0x200, end: BASE + 0x200 }, kind: 'data' },
    { span: { start: BASE + 0x300, end: BASE + 0x310 }, kind: 'code' },
  ]);
  assert.deepEqual(spans, [
    { start: BASE + 0x110, end: BASE + 0x130 },
    { start: BASE + 0x3f0, end: BASE + 0x400 },
  ]);
  assert.deepEqual(outsideSpans(spans, BASE + 0x100, BASE + 0x140), [
    { start: BASE + 0x100, end: BASE + 0x110 },
    { start: BASE + 0x130, end: BASE + 0x140 },
  ]);
  assert.deepEqual(outsideSpans(spans, BASE + 0x114, BASE + 0x120), []);
});
