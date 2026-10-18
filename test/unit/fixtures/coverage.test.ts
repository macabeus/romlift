// Rule coverage of the committed synthetic fixtures (architecture §13 g2.rule-coverage, D7, D57): every
// analysis rule is either load-bearing on a named fixture, so that disabling it makes that fixture's
// expect.json fail, or exempted by D57, in which case disabling it moves no fixture outcome. The table is
// the one of bench/dataset/synthetic/index.md; `bench ablate` reports the same through the CLI.
//
// `cited` says that a decision event of the trail ('accept', 'reject', 'verdict', 'claim', 'absorb')
// names the rule in that fixture. Every covered rule is cited: an accept rule by the 'accept' event the
// driver emits beside the proposer's, a walk rule by a 'verdict' event for each walk-slot answer of an
// accepted reading (Reading.steps), and the gap slots prefer and skip by a 'verdict' event at the cursor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { isRuleId, profileById, type AnalysisOptions, type CompilerProfile, type RuleId } from 'romlift';
import { analyzeTuned, DEFAULT_TUNING, RULES } from 'romlift/internal';

import { decisionSink, outcomeOf } from '../../../bench/src/ablate.ts';
import { expectProblems, listSyntheticFixtures, readExpect, readFixtureRom, SYNTHETIC_ROOT, type SyntheticFixture } from '../../helpers/fixtures.ts';

interface Coverage {
  /** A fixture whose expect.json fails with the rule disabled. */
  readonly fixture: string;
  /** Whether a decision event of that fixture's trail names the rule. */
  readonly cited: boolean;
}

const COVERAGE: Readonly<Record<RuleId, Coverage>> = {
  'accept.pointer-table-run': { fixture: 'leaf-handler-pointer-table', cited: true },
  'accept.prologue-and-calls-accepted': { fixture: 'data-named-between-data', cited: true },
  'accept.prologue-and-end-anchored': { fixture: 'large-data-referenced', cited: true },
  'accept.prologue-and-loaded': { fixture: 'data-table-between-functions', cited: true },
  'accept.tiles-after-accepted': { fixture: 'handwritten-2mod4', cited: true },
  'accept.tiny-anchored-at-start': { fixture: 'false-stub-2byte', cited: true },
  'bl.near-is-call': { fixture: 'local-subroutine', cited: true },
  'bl.self-or-accepted': { fixture: 'recursive-far-call', cited: true },
  'bl.target-before-entry': { fixture: 'pops-unpushed-frame', cited: true },
  'bl.target-beyond-callee': { fixture: 'pops-unpushed-frame', cited: true },
  'bl.target-has-prologue': { fixture: 'pops-unpushed-frame', cited: true },
  'bl.target-inside-caller': { fixture: 'far-jump', cited: true },
  'bl.target-pops-unpushed-frame': { fixture: 'pops-unpushed-frame', cited: true },
  'claim.adjacent-pools': { fixture: 'pool-padded-46c0', cited: true },
  'claim.dead-code-in-extent': { fixture: 'dead-code-in-extent', cited: true },
  'claim.far-pools': { fixture: 'pool-word-push-lr', cited: true },
  'gap.adr-block-absorb': { fixture: 'adr-handler-block', cited: true },
  'gap.arm-over-prologueless-thumb': { fixture: 'prologueless-thumb-over-arm', cited: true },
  'gap.arm-scan': { fixture: 'arm-pools-in-front', cited: true },
  'gap.backward-prologue-chain': { fixture: 'data-table-between-functions', cited: true },
  'gap.end-anchor': { fixture: 'data-table-between-functions', cited: true },
  'gap.forward-chain': { fixture: 'unreferenced-leaf', cited: true },
  'gap.skip-padding-and-pointers': { fixture: 'thumb-pointer-run', cited: true },
  'gap.tiled-hole': { fixture: 'mixer-tiled-hole', cited: true },
  'gap.tiled-hole-inner': { fixture: 'mixer-tiled-hole', cited: true },
  'seed.adr': { fixture: 'mov-lr-pc-bx', cited: true },
  'seed.call': { fixture: 'local-subroutine', cited: true },
  'seed.data-pointer': { fixture: 'leaf-handler-pointer-table', cited: true },
  'seed.pool-pointer': { fixture: 'data-table-between-functions', cited: true },
  'seed.ram-copy': { fixture: 'ram-code-entries', cited: true },
  'seed.rom-entry': { fixture: 'swi-reset', cited: true },
  'seed.startup-pointer': { fixture: 'code-end-data-decodes', cited: true },
  'seed.veneer': { fixture: 'bx-pc-veneer', cited: true },
  'valid.balanced-stack': { fixture: 'data-thumb-push-pop', cited: true },
  'valid.calls-code': { fixture: 'data-thumb-push-pop', cited: true },
  'valid.decodes': { fixture: 'data-thumb-push-pop', cited: true },
  'valid.dense': { fixture: 'data-thumb-push-pop', cited: true },
  'valid.no-claimed-code': { fixture: 'pool-word-push-lr', cited: true },
  'valid.not-pointer-table': { fixture: 'pointer-table-before-leaf', cited: true },
  'valid.pool-not-code': { fixture: 'data-thumb-push-pop', cited: true },
  'valid.returns-or-prologue': { fixture: 'thumb-pointer-run', cited: true },
  'walk.branch-into-function': { fixture: 'shared-tail', cited: true },
  'walk.inline-arm-switch': { fixture: 'inline-arm-switch', cited: true },
  'walk.bx-pc-veneer': { fixture: 'bx-pc-veneer', cited: true },
  'walk.mov-lr-pc-bx-is-call': { fixture: 'mov-lr-pc-bx', cited: true },
  'walk.mov-pc-without-table': { fixture: 'computed-jump-callback', cited: true },
  'walk.noreturn-call-before-noncode': { fixture: 'noreturn-call-then-next', cited: true },
  'walk.pc-load-is-pool': { fixture: 'pool-padded-46c0', cited: true },
  'walk.swi-before-noncode': { fixture: 'swi-reset', cited: true },
  'walk.table-by-register': { fixture: 'table-jump-hoisted', cited: true },
  'walk.trailing-zero-padding': { fixture: 'noreturn-call-then-next', cited: true },
};

/** The rules D57 exempts: none can move an entry, an extent or the code end of a seedless discover run. */
const EXEMPT: readonly RuleId[] = [
  'bl.noreturn-before-noncode',
  'region.data-after-code',
  'region.padding',
  'region.startup',
  'seed.evidence-hint',
  'seed.listed',
  'seed.override',
  'valid.in-rom-unclaimed',
];


const FIXTURES = listSyntheticFixtures();
const OPTIONS: AnalysisOptions = { mode: 'discover', seeds: [], overrides: [], trail: 'off' };
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

/** The covered rules with their fixtures, in table order. */
function covered(): readonly (Coverage & { readonly rule: RuleId })[] {
  return Object.keys(COVERAGE)
    .filter(isRuleId)
    .flatMap((rule) => {
      const c = COVERAGE[rule];
      return c === undefined ? [] : [{ rule, ...c }];
    });
}

function without(f: SyntheticFixture, rule: RuleId, profile: CompilerProfile): ReturnType<typeof analyzeTuned> {
  return analyzeTuned(readFixtureRom(f), profile, OPTIONS, { ...DEFAULT_TUNING, disabled: [rule] });
}

test('every rule of RULES is load-bearing on a named fixture or exempted by D57, exactly once', () => {
  const ids = Object.keys(RULES).sort(byCodeUnit);
  const listed = [...Object.keys(COVERAGE), ...EXEMPT].sort(byCodeUnit);
  assert.deepEqual(listed, ids);
});

test('disabling a covered rule makes its fixture\'s expect.json fail', () => {
  const profile = agbcc();
  for (const { rule, fixture: name } of covered()) {
    const f = fixture(name);
    assert.ok(expectProblems(readExpect(f), without(f, rule, profile)).length > 0, `${rule} on ${name}`);
  }
});

test('the trail of each fixture cites its covered rules, in a decision event', () => {
  const profile = agbcc();
  for (const { rule, fixture: name, cited } of covered()) {
    assert.ok(cited, `${rule} is covered, so its fixture's trail must cite it`);
    const sink = decisionSink(rule);
    analyzeTuned(readFixtureRom(fixture(name)), profile, { ...OPTIONS, trail: 'decisions' }, DEFAULT_TUNING, sink);
    assert.ok(sink.decisive(), `${rule} on ${name}`);
  }
});

test('disabling an exempted rule moves no fixture outcome', () => {
  const profile = agbcc();
  for (const f of FIXTURES) {
    const base = outcomeOf(analyzeTuned(readFixtureRom(f), profile, OPTIONS, DEFAULT_TUNING));
    for (const rule of EXEMPT) assert.equal(outcomeOf(without(f, rule, profile)), base, `${rule} on ${f.name}`);
  }
});

test('D57 names every exempted rule with g2.rule-coverage, and no covered rule', () => {
  const decisions = readFileSync(join(SYNTHETIC_ROOT, '..', '..', '..', 'docs', 'decisions.md'), 'utf8');
  const sections = decisions.split(/^## /m).filter((s) => s.includes('g2.rule-coverage'));
  const d57 = sections.find((s) => s.startsWith('D57.'));
  assert.ok(d57 !== undefined, 'D57 names g2.rule-coverage');
  for (const id of EXEMPT) assert.ok(d57.includes(`\`${id}\``), id);
  for (const id of Object.keys(COVERAGE)) assert.ok(!sections.some((s) => s.includes(`\`${id}\``)), `${id} is load-bearing and must not be exempted`);
});
