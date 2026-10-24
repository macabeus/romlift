// The analyze --update workflow (architecture §2.1, §6.5, D9, D23), pure: on init's config nothing is proposed and
// the text is unchanged; an entry deleted by hand comes back as a function proposal (source analysis, no `from`) that
// planPatch inserts in place, keeping the user's comments; a listed entry with `from` is validated and, when it fails,
// reported (W_LISTED_INVALID) and kept, one without `from` is taken as it is (D76 a, D77 e); another ROM is refused; a nested discovery is proposed as a label;
// a patch whose module starts generate would refuse is refused with E_MODULE_BORDER naming the proposal
// (architecture-r1-3, a0-4); and unifiedDiff renders a patch in `diff -u` form.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { analyzeUpdate, staleConfigProblems, unlistedProposals } from '../../../src/core/workflow/analyze-update.ts';
import { unifiedDiff } from '../../../src/foundation/util/line-diff.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { borderRefs } from '../../../src/core/layout/refs.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
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

test('the confirm run validates only listed entries with `from` (D76 a, D77 e): one that fails is W_LISTED_INVALID and stays listed', () => {
  const rom = fixtureRom('far-jump');
  const { config } = project(rom);
  // The cartridge header's middle is no Thumb function, and discover does not find it.
  const withEntry = (from?: string) => {
    const functions = new Map(config.functions);
    functions.set(0x0800_0020, { name: 'NotAFunction', mode: 'thumb', aliases: [], ...(from === undefined ? {} : { from }) });
    return { ...config, functions };
  };
  const proposed = withEntry('evidence:trace');
  const plan = analyzeUpdate({ rom, configText: serializeConfig(proposed), config: proposed });
  assert.ok(plan.ok);
  assert.equal(plan.changed, false);
  assert.ok(plan.diagnostics.some((d) => d.code === 'W_LISTED_INVALID' && d.addr === 0x0800_0020), plan.diagnostics.map((d) => d.code).join(', '));
  const byHand = withEntry();
  const quiet = analyzeUpdate({ rom, configText: serializeConfig(byHand), config: byHand });
  assert.ok(quiet.ok);
  assert.ok(!quiet.diagnostics.some((d) => d.code === 'W_LISTED_INVALID'), 'an entry without `from` is taken as it is, found or not');
});

/**
 * A config on disk generate accepts, which a newer discover's proposal makes illegal: init's config without a found
 * Thumb function F, with the target X of a short forward branch of F listed as a function of its own and a `c`
 * module split at X. Without F listed, F's bytes are no code of the confirm run, so nothing crosses X; with F
 * proposed back, F's branch crosses X.
 */
function coveredStart(rom: Rom): { readonly config: RomliftConfig; readonly f: number; readonly x: number } | undefined {
  const discovered = discover(rom);
  const init = configFromDiscover(rom, discovered);
  const branches = borderRefs(rom, discovered).shortBranches;
  for (const f of discovered.functions) {
    if (f.mode !== 'thumb' || !init.functions.has(f.entry) || init.modules.some((m) => m.start === f.entry)) continue;
    for (const b of branches) {
      const x = b.target;
      if (b.site < f.entry || x <= b.site + 2 || x >= f.extent.end || x % 4 !== 0 || init.functions.has(x) || init.modules.some((m) => m.start === x)) continue;
      const functions = new Map(init.functions);
      functions.delete(f.entry);
      functions.set(x, { name: 'ListedByHand', mode: 'thumb', aliases: [] });
      const i = init.modules.findIndex((m, k) => m.start < x && x < (init.modules[k + 1]?.start ?? rom.end));
      const parent = init.modules[i];
      if (parent === undefined) continue;
      const modules = [...init.modules.slice(0, i + 1), { name: 'split_here', start: x, kind: 'c' as const, generated: true }, ...init.modules.slice(i + 1)];
      const config = { ...init, functions, modules };
      if (confirmModel({ rom, config }).model.diagnostics.some((d) => d.code === 'E_MODULE_BORDER')) continue;
      return { config, f: f.entry, x };
    }
  }
  return undefined;
}

test('a patch whose module starts generate would refuse is E_MODULE_BORDER naming the proposal, and nothing is offered (architecture-r1-3, a0-4)', () => {
  const found = listSyntheticFixtures()
    .map((fixture) => ({ fixture, rom: readFixtureRom(fixture) }))
    .map(({ fixture, rom }) => ({ fixture, rom, case: coveredStart(rom) }))
    .find((c) => c.case !== undefined);
  assert.ok(found?.case !== undefined, 'some committed fixture has a short forward branch to a word to split at');
  const { rom, case: { config, f, x } } = found;
  const text = serializeConfig(config);
  const plan = analyzeUpdate({ rom, configText: text, config });
  assert.equal(plan.ok, false, `${found.fixture.name}: the patch adding ${f.toString(16)} is refused`);
  const borders = plan.ok ? [] : plan.diagnostics.filter((d) => d.code === 'E_MODULE_BORDER');
  assert.equal(borders.length, 1, plan.ok ? '' : plan.diagnostics.map((d) => d.message).join('; '));
  assert.equal(borders[0]?.addr, x);
  assert.match(borders[0]?.message ?? '', new RegExp(`proposed function 0x${f.toString(16).toUpperCase().padStart(8, '0')}, generate would refuse romlift.toml: module split_here starts at`));
  assert.equal(borders[0]?.cites?.[0], f);
  // The refusal is generate's: the TOML the patch would have written gives E_MODULE_BORDER at X.
  const functions = new Map(config.functions);
  functions.set(f, { name: `sub_${f.toString(16).toUpperCase().padStart(8, '0')}`, mode: 'thumb', aliases: [] });
  assert.ok(confirmModel({ rom, config: { ...config, functions } }).model.diagnostics.some((d) => d.code === 'E_MODULE_BORDER' && d.addr === x));
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

test('staleConfigProblems: a config that changed on disk since it was read is E_STALE_CONFIG, so --write saves nothing (architecture-12)', () => {
  assert.deepEqual(staleConfigProblems('romlift.toml', 'a = 1\n', 'a = 1\n'), []);
  const stale = staleConfigProblems('romlift.toml', 'a = 1\n', 'a = 1\n# edited meanwhile\n');
  assert.deepEqual(stale.map((d) => [d.code, d.severity, d.path]), [['E_STALE_CONFIG', 'error', 'romlift.toml']]);
});
