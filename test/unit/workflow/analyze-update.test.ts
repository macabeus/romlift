// The analyze --update workflow (architecture §2.1, §6.5, D9, D23), pure: on init's config nothing is proposed and
// the text is unchanged; an entry deleted by hand comes back as a function proposal (source analysis, no `from`) that
// planPatch inserts in place, keeping the user's comments; an entry discover no longer finds is validated and, when
// it fails, reported (W_LISTED_INVALID) and kept; another ROM is refused; a nested discovery is proposed as a label;
// and unifiedDiff renders a patch in `diff -u` form.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Seed } from '../../../src/core/analysis/types.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { analyzeUpdate, unlistedProposals, updateSeeds } from '../../../src/core/workflow/analyze-update.ts';
import { unifiedDiff } from '../../../src/foundation/util/line-diff.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

function fixtureRom(name: string): Rom {
  return readFixtureRom(listSyntheticFixtures().find((f) => f.name === name) ?? assert.fail(name));
}

function project(rom: Rom): { readonly text: string; readonly config: ReturnType<typeof configFromDiscover> } {
  const config = configFromDiscover(rom, discover(rom));
  return { text: serializeConfig(config), config };
}

test("on init's config nothing is proposed and the TOML is unchanged, on every committed fixture", () => {
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const { text, config } = project(rom);
    const plan = analyzeUpdate({ rom, configText: text, config });
    assert.ok(plan.ok, fixture.name);
    assert.deepEqual(plan.proposals, [], fixture.name);
    assert.equal(plan.changed, false, fixture.name);
    assert.equal(plan.text, text, fixture.name);
  }
});

test('an entry deleted by hand is proposed again and patched back in place; comments survive; the result parses', () => {
  const rom = fixtureRom('composite');
  const { text } = project(rom);
  const lines = text.split('\n');
  const at = lines.findIndex((l, i) => i > lines.indexOf('[functions]') + 2 && /^0x0[0-9A-F]{7} = "sub_/.test(l));
  const removed = lines[at] ?? assert.fail('no entry to delete');
  const edited = ['# my project', ...lines.slice(0, at), ...lines.slice(at + 1)].join('\n').replace('[functions]', '[functions]  # every entry');
  const parsed = parseConfig(edited);
  assert.ok(parsed.ok);
  const plan = analyzeUpdate({ rom, configText: edited, config: parsed.value });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.message).join('; '));
  assert.equal(plan.proposals.length, 1);
  const proposal = plan.proposals[0];
  assert.ok(proposal?.kind === 'function' && proposal.source.kind === 'analysis');
  assert.equal(`0x${proposal.addr.toString(16).toUpperCase().padStart(8, '0')}`, removed.slice(0, 10));
  assert.ok(plan.changed);
  assert.equal(plan.text, ['# my project', ...lines].join('\n').replace('[functions]', '[functions]  # every entry'));
  assert.ok(!plan.text.includes('from ='), 'the analysis is never persisted as a from key');
  const diff = unifiedDiff(edited, plan.text, 'romlift.toml');
  assert.match(diff, new RegExp(`\\n\\+${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
});

test('another ROM than [rom] sha1 records is E_ROM_SHA1_MISMATCH', () => {
  const rom = fixtureRom('far-jump');
  const { text, config } = project(rom);
  const plan = analyzeUpdate({ rom, configText: text, config: { ...config, rom: { ...config.rom, sha1: '1'.repeat(40) } } });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.ok ? [] : plan.diagnostics.map((d) => d.code), ['E_ROM_SHA1_MISMATCH']);
});

test('an entry the user listed that discover does not find is validated: a failing one is W_LISTED_INVALID and stays listed', () => {
  const rom = fixtureRom('far-jump');
  const { config } = project(rom);
  // The cartridge header's middle is no Thumb function.
  const functions = new Map(config.functions);
  functions.set(0x0800_0020, { name: 'NotAFunction', mode: 'thumb', aliases: [] });
  const withBad = { ...config, functions };
  const text = serializeConfig(withBad);
  const plan = analyzeUpdate({ rom, configText: text, config: withBad });
  assert.ok(plan.ok);
  assert.equal(plan.changed, false);
  assert.ok(plan.diagnostics.some((d) => d.code === 'W_LISTED_INVALID' && d.addr === 0x0800_0020), plan.diagnostics.map((d) => d.code).join(', '));
});

test('updateSeeds validates exactly the listed entries discover did not find (never a label)', () => {
  const seeds: Seed[] = [
    { entry: 0x0800_0100, mode: 'thumb', rule: 'seed.listed' },
    { entry: 0x0800_0200, mode: 'thumb', rule: 'seed.listed' },
    { entry: 0x0800_0300, mode: 'thumb', rule: 'seed.listed', label: true },
  ];
  assert.deepEqual(
    updateSeeds(seeds, new Set([0x0800_0100])).map((s) => s.validate === true),
    [false, true, false],
  );
});

test('unlistedProposals: found and not listed, with label = true for an entry inside another found extent', () => {
  const rom = fixtureRom('far-jump');
  const found = discover(rom);
  const config = configFromDiscover(rom, found);
  assert.deepEqual(unlistedProposals(found, config), []);
  const listedLabels = [...config.functions].filter(([, f]) => f.label === true).map(([a]) => a);
  const proposals = unlistedProposals(found, { functions: new Map() });
  assert.equal(proposals.length, found.functions.length);
  assert.deepEqual(proposals.filter((p) => p.kind === 'function' && p.label === true).map((p) => (p.kind === 'function' ? p.addr : 0)), listedLabels);
});

test('unifiedDiff: empty for equal texts, hunks with three lines of context, additions at the end and the start', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n', 'x'), '');
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const after = before.replace('line 10\n', 'line 10\nnew\n').replace('line 0\n', '');
  assert.equal(
    unifiedDiff(before, after, 'f.txt'),
    ['--- a/f.txt', '+++ b/f.txt', '@@ -1,4 +1,3 @@', '-line 0', ' line 1', ' line 2', ' line 3', '@@ -9,6 +8,7 @@', ' line 8', ' line 9', ' line 10', '+new', ' line 11', ' line 12', ' line 13', ''].join('\n'),
  );
  assert.equal(unifiedDiff('', 'a\n', 'n'), '--- a/n\n+++ b/n\n@@ -0,0 +1,1 @@\n+a\n');
  assert.equal(unifiedDiff('a\n', '', 'n'), '--- a/n\n+++ b/n\n@@ -1,1 +0,0 @@\n-a\n');
});
