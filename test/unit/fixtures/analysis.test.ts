// The merged analysis on the committed synthetic fixtures (architecture §8.1, §4.3, §4.4, §8.4): each
// fixture's expect.json holds under agbcc (what g2.synthetic-analysis asserts), the dummy profile runs on
// every fixture (g2.second-profile), two runs give one canonical analysis (the in-process half of
// g2.determinism; the two-process half needs `romlift analyze --json`), and the suppressed split of
// unreferenced-leaf is a glued miss for the held-out classifier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { analyze, encodeAnalysis, parseElf, profileById, type AnalysisOptions, type AnalysisResult, type CompilerProfile } from 'romlift';
import { analyzeTuned, DEFAULT_TUNING } from 'romlift/internal';

import { sealedInput } from '../../../bench/src/analysis-run.ts';
import { classifier, classifyMiss, labelClause } from '../../../bench/src/classify.ts';
import { elfTruth } from '../../../bench/src/truth.ts';
import { DUMMY_PROFILE } from '../../helpers/dummy-profile.ts';
import { expectProblems, listSyntheticFixtures, readExpect, readFixtureRom, type SyntheticFixture } from '../../helpers/fixtures.ts';

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

const digest = (result: AnalysisResult): string => [...encodeAnalysis(result)].join('');

test('every fixture holds its expect.json under the agbcc profile', () => {
  const profile = agbcc();
  for (const f of FIXTURES) assert.deepEqual(expectProblems(readExpect(f), analyze(readFixtureRom(f), profile, OPTIONS)), [], f.name);
});

test('the dummy profile runs on every fixture and records its id, with the functions in entry order', () => {
  for (const f of FIXTURES) {
    const result = analyze(readFixtureRom(f), DUMMY_PROFILE, OPTIONS);
    assert.equal(result.schema, 'romlift/analysis@1', f.name);
    assert.equal(result.profile, 'dummy', f.name);
    assert.ok(result.functions.length > 0, f.name);
    for (let i = 1; i < result.functions.length; i++) assert.ok((result.functions[i - 1]?.entry ?? 0) < (result.functions[i]?.entry ?? 0), `${f.name}: entry order`);
  }
});

test('two runs of every fixture give one canonical analysis, with either profile', () => {
  for (const profile of [agbcc(), DUMMY_PROFILE]) {
    for (const f of FIXTURES) assert.equal(digest(analyze(readFixtureRom(f), profile, OPTIONS)), digest(analyze(readFixtureRom(f), profile, OPTIONS)), `${f.name} (${profile.id})`);
  }
});

test('the suppressed split: without gap.forward-chain, the unreferenced Leaf is missed and classified glued', () => {
  const f = fixture('unreferenced-leaf');
  const rom = readFixtureRom(f);
  const elf = parseElf(new Uint8Array(readFileSync(f.elf)));
  assert.ok(elf.ok);
  const leaf = elf.value.symbols.find((s) => s.name === 'Leaf' && s.type === 'func');
  assert.ok(leaf !== undefined);
  const truth = elfTruth(elf.value, rom.bytes.length);
  const profile = agbcc();

  const split = analyze(rom, profile, OPTIONS);
  assert.ok(split.functions.some((fn) => fn.entry === leaf.addr), 'with the rule, Leaf is found');

  const suppressed = analyzeTuned(rom, profile, OPTIONS, { ...DEFAULT_TUNING, disabled: ['gap.forward-chain'] });
  assert.ok(!suppressed.functions.some((fn) => fn.entry === leaf.addr), 'without the rule, Leaf is missed');
  const cx = classifier(sealedInput(f.name, { rom, truth }, suppressed, profile));
  assert.equal(labelClause(cx, leaf.addr), undefined);
  assert.equal(classifyMiss(cx, leaf.addr), 'glued');
});
