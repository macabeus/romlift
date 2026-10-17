// The decision trail cites the rules that decided (D58): the acceptance rule beside the proposer, a
// 'verdict' for each walk-slot answer of an accepted reading (kept across settle rounds), and the gap
// slots prefer and skip. Tracing the walk changes no result: the analysis is the same with the trail on
// and off.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalJson, profileById, type AnalysisOptions, type AnalysisResult, type CompilerProfile, type JsonValue, type TrailEvent } from 'romlift';
import { analyzeTuned, DEFAULT_TUNING } from 'romlift/internal';

import { listSyntheticFixtures, readFixtureRom, type SyntheticFixture } from '../../../helpers/fixtures.ts';

const FIXTURES = listSyntheticFixtures();
const OPTIONS: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'off' };

function agbcc(): CompilerProfile {
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  return profile;
}

function fixture(name: string): SyntheticFixture {
  const f = FIXTURES.find((x) => x.name === name);
  assert.ok(f !== undefined, `no fixture ${name}`);
  return f;
}

function traced(name: string): { readonly result: AnalysisResult; readonly events: readonly TrailEvent[] } {
  const events: TrailEvent[] = [];
  const result = analyzeTuned(readFixtureRom(fixture(name)), agbcc(), { ...OPTIONS, trail: 'decisions' }, DEFAULT_TUNING, { event: (e) => events.push(e) });
  return { result, events };
}

const digest = (r: AnalysisResult): string => Array.from(canonicalJson(r as unknown as JsonValue)).join('');
const without = (r: AnalysisResult): AnalysisResult => ({ ...r, options: { ...r.options, trail: 'off' } });

test('tracing changes no analysis result on any fixture', () => {
  for (const f of FIXTURES) {
    const off = analyzeTuned(readFixtureRom(f), agbcc(), OPTIONS, DEFAULT_TUNING);
    const on = analyzeTuned(readFixtureRom(f), agbcc(), { ...OPTIONS, trail: 'decisions' }, DEFAULT_TUNING, { event: () => undefined });
    assert.equal(digest(without(on)), digest(off), f.name);
  }
});

test('an accept rule that takes a harvested candidate has its own accept event beside the proposer', () => {
  const { events } = traced('leaf-handler-pointer-table');
  const taken = events.filter((e) => e.kind === 'accept' && e.rule === 'accept.pointer-table-run');
  assert.ok(taken.length > 0);
  for (const e of taken) assert.ok(events.some((p) => p.kind === 'accept' && p.at === e.at && p.rule.startsWith('seed.')), `proposer of ${e.at}`);
});

test('a walk step of an accepted reading is a verdict at its instruction, cited with the entry', () => {
  const { result, events } = traced('pool-padded-46c0');
  const pools = events.filter((e) => e.kind === 'verdict' && e.rule === 'walk.pc-load-is-pool');
  assert.ok(pools.length > 0);
  const entries = new Set(result.functions.map((f) => f.entry));
  for (const e of pools) {
    assert.equal(e.detail, 'pool');
    assert.ok(entries.has(e.cites[0] ?? -1), 'the first cite is the accepted entry');
    assert.ok(e.cites.includes(e.at), 'the instruction is cited (once, when it is the entry)');
  }
});

test('an earlier settle round decides a noreturn call; its walk answers are still cited', () => {
  const { events } = traced('noreturn-call-then-next');
  assert.ok(events.some((e) => e.kind === 'verdict' && e.rule === 'walk.noreturn-call-before-noncode' && e.detail === 'end-path'));
  assert.ok(events.some((e) => e.kind === 'verdict' && e.rule === 'walk.trailing-zero-padding' && e.detail === 'padding'));
});

test('the gap slots prefer and skip decide at a cursor and are cited as verdicts', () => {
  assert.ok(traced('prologueless-thumb-over-arm').events.some((e) => e.kind === 'verdict' && e.rule === 'gap.arm-over-prologueless-thumb' && e.detail === 'arm over thumb'));
  assert.ok(traced('thumb-pointer-run').events.some((e) => e.kind === 'verdict' && e.rule === 'gap.skip-padding-and-pointers' && e.detail?.startsWith('skips to 0x') === true));
});

test('a trail of level off records nothing', () => {
  const events: TrailEvent[] = [];
  analyzeTuned(readFixtureRom(fixture('pool-padded-46c0')), agbcc(), OPTIONS, DEFAULT_TUNING, { event: (e) => events.push(e) });
  assert.deepEqual(events, []);
});
