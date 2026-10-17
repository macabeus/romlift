// Fault injection into the held-out classifier (g2.checks-fail, architecture §8.4 "Held-out runs", §10,
// D25): a split the analysis should make is suppressed, and the classifier must call the resulting miss
// `glued`, which fails the sealed ROM. The fault is real: the committed unreferenced-leaf fixture is
// analysed with gap.forward-chain disabled (the only rule that finds its Leaf), and the classifier input
// is built from that result and the fixture's ELF exactly as a sealed `bench run` builds it. A second,
// hand-built fault puts a `bl` target inside a found extent: a misjudged far `bl` is how a real function
// gets glued, so the target must be glued, never a label.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseElf, profileById, romFromBytes, type AnalysisResult, type CompilerProfile, type Rom, type RuleId } from 'romlift';
import { analyzeTuned, DEFAULT_TUNING } from 'romlift/internal';

import { discoverOptions, sealedInput } from '../../../bench/src/analysis-run.ts';
import { classifier, classifyMiss, labelClause, type ClassifyInput, type FoundFunction } from '../../../bench/src/classify.ts';
import { sealedCounts, sealedPasses } from '../../../bench/src/seal.ts';
import { elfTruth, type Truth } from '../../../bench/src/truth.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';

const FIXTURE = 'unreferenced-leaf';
/** The fixture's Leaf (build/unreferenced-leaf.elf): an ELF FUNC nothing calls, found only by the forward chain. */
const LEAF = 0x0800_0108;
const SPLITTING_RULE: RuleId = 'gap.forward-chain';

interface FixtureInputs {
  readonly rom: Rom;
  readonly truth: Truth;
  readonly profile: CompilerProfile;
}

function fixtureInputs(): FixtureInputs {
  const fixture = listSyntheticFixtures().find((f) => f.name === FIXTURE);
  assert.ok(fixture !== undefined, `the committed fixture ${FIXTURE} is missing`);
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  const elf = parseElf(new Uint8Array(readFileSync(fixture.elf)));
  assert.ok(elf.ok, elf.ok ? '' : elf.error);
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  return { rom: romFromBytes(bytes, FIXTURE), truth: elfTruth(elf.value, bytes.length), profile };
}

function run(inputs: FixtureInputs, disabled: readonly RuleId[]): AnalysisResult {
  return analyzeTuned(inputs.rom, inputs.profile, discoverOptions(), { ...DEFAULT_TUNING, disabled: [...disabled] });
}

test('unmutated, the fixture finds Leaf, so the classifier has no miss to judge', () => {
  const inputs = fixtureInputs();
  assert.equal(inputs.truth.byAddr.get(LEAF)?.name, 'Leaf');
  const result = run(inputs, []);
  const leaf = result.functions.find((f) => f.entry === LEAF);
  assert.equal(leaf?.origin, 'gap-scan');
  const counts = sealedCounts(sealedInput(FIXTURE, inputs, result, inputs.profile));
  assert.equal(counts.glued, 0);
  assert.equal(counts.labelCandidates, 0);
});

test('with the splitting rule disabled, the missed Leaf classifies as glued and fails the sealed ROM', () => {
  const inputs = fixtureInputs();
  const result = run(inputs, [SPLITTING_RULE]);
  assert.equal(result.functions.some((f) => f.entry === LEAF), false, `${SPLITTING_RULE} disabled must lose Leaf`);
  const input = sealedInput(FIXTURE, inputs, result, inputs.profile);
  const cx = classifier(input);
  assert.equal(labelClause(cx, LEAF), undefined);
  assert.equal(classifyMiss(cx, LEAF), 'glued');
  const counts = sealedCounts(input);
  assert.equal(counts.glued, 1);
  assert.equal(counts.labelCandidates, 0);
  const verdict = sealedPasses(counts);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failures.includes('glued'), `failures: ${verdict.failures.join(', ')}`);
});

// A hand-built parent F at [0x08000200, 0x08000300), an ELF FUNC, with a real function M at 0x08000240
// inside its extent: M is the target of a `bl` of F (the far `bl` was misjudged as a local call).
const F = 0x0800_0200;
const M = 0x0800_0240;

function parent(overrides: Partial<FoundFunction> = {}): FoundFunction {
  return { entry: F, mode: 'thumb', extent: { start: F, end: 0x0800_0300 }, holes: [], branchTargets: [], noReturnSites: [], callTargets: [], origin: 'call', ...overrides };
}

function handBuilt(f: FoundFunction): ClassifyInput {
  return {
    found: [f],
    truth: [
      { addr: F, size: 0x40, thumb: true },
      { addr: M, size: 0x40, thumb: true },
    ],
    startupEnd: 0x0800_0100,
    isPrologue: () => false,
  };
}

test('a bl target inside a found extent is glued, not a label', () => {
  assert.equal(classifyMiss(classifier(handBuilt(parent({ callTargets: [M] }))), M), 'glued');
  // Also when the same address is a b/bcc target of F: the bl target vetoes clause (b).
  const both = classifier(handBuilt(parent({ branchTargets: [M], callTargets: [M] })));
  assert.equal(labelClause(both, M), undefined);
  assert.equal(classifyMiss(both, M), 'glued');
  // The control: a b/bcc target alone is a label candidate, so the veto is what decides.
  assert.equal(classifyMiss(classifier(handBuilt(parent({ branchTargets: [M] }))), M), 'label-candidate');
});
