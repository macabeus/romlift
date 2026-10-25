// The analyze --update workflow (architecture §2.1, §6.5, D9, D23), pure: on init's config nothing is proposed and
// the text is unchanged; an entry deleted by hand comes back as a function proposal (source analysis, no `from`) that
// planPatch inserts in place, keeping the user's comments; a listed entry with `from` is validated and, when it fails,
// reported (W_LISTED_INVALID) and kept, one without `from` is taken as it is (D76 a, D77 e); another ROM is refused; a nested discovery is proposed as a label;
// a patch whose module starts generate would refuse is refused with E_MODULE_BORDER naming the proposal
// (architecture-r1-3, a0-4); the borders of a hand-written runs_at range are proposed as modules (`ram_<RUNADDR>` at
// its start, the module it splits resumed at its end, §6.7), and a range that cannot be its own module is
// E_OVERRIDE_INVALID; and unifiedDiff renders a patch in `diff -u` form. From phase 6, with signature files: entries
// that still carry a default name are renamed with `from`, a table added, a missing library module inserted with the
// module it split resumed, a user's name kept, nothing proposed while [signatures] is disabled, and a contradiction
// of the config reported as W_EVIDENCE_CONFLICT without changing the rest.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { analyzeUpdate, runsAtBorders, staleConfigProblems, unlistedProposals } from '../../../src/core/workflow/analyze-update.ts';
import { unifiedDiff } from '../../../src/foundation/util/line-diff.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { ModuleConfig, OverrideConfig, RomliftConfig } from '../../../src/core/config/schema.ts';
import { borderRefs } from '../../../src/core/layout/refs.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile } from '../../../src/core/signatures/schema.ts';
import { initConfigOf } from '../../../src/core/workflow/init-config.ts';
import { listSyntheticFixtures, readFixtureRom, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';

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

const RAM_ROM = { base: 0x0800_0000, end: 0x0800_4000 } as const;

function moduleAt(name: string, start: number, kind: ModuleConfig['kind'] = 'asm', library?: { readonly name: string; readonly version: string }): ModuleConfig {
  return { name, start, kind, generated: true, ...(library === undefined ? {} : { library: library.name, version: library.version }) };
}

function ramRange(start: number, size: number, runsAt: number): OverrideConfig {
  return { start, size, kind: 'code', mode: 'thumb', runsAt };
}

test('runsAtBorders: an asm module ram_<RUNADDR> at the start, and the split module resumed at the end with its kind, library and version', () => {
  const modules = [moduleAt('rom_header', 0x0800_0000), moduleAt('m4a', 0x0800_1000, 'asm', { name: 'm4a', version: '2001' }), moduleAt('main', 0x0800_3000, 'c')];
  const r = runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_1318, 0x3a4, 0x0300_0388), { start: 0x0800_0200, size: 0x10, kind: 'data' }] });
  assert.deepEqual(r.refusals, []);
  assert.deepEqual(r.proposals, [
    { kind: 'module', name: 'ram_03000388', start: 0x0800_1318, moduleKind: 'asm', source: { kind: 'layout', reason: 'runs-at' } },
    { kind: 'module', name: 'm4a_080016BC', start: 0x0800_16bc, moduleKind: 'asm', library: { name: 'm4a', version: '2001' }, source: { kind: 'layout', reason: 'runs-at' } },
  ]);
  // A c module split by the range is resumed as a c module.
  const c = runsAtBorders(RAM_ROM, { modules: [moduleAt('rom_header', 0x0800_0000), moduleAt('main', 0x0800_0100, 'c')], overrides: [ramRange(0x0800_0400, 0x40, 0x0300_0000)] });
  assert.deepEqual(c.proposals.map((p) => [p.name, p.start, p.moduleKind]), [['ram_03000000', 0x0800_0400, 'asm'], ['main_08000440', 0x0800_0440, 'c']]);
});

test('runsAtBorders: no proposal at a border that exists or at the ROM end; a taken name gets _2', () => {
  const modules = [moduleAt('rom_header', 0x0800_0000), moduleAt('ram_03000000', 0x0800_0100), moduleAt('data', 0x0800_0400, 'data')];
  assert.deepEqual(runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_0400, 0x3c00, 0x0300_0000)] }).proposals, [], 'a module starts there and the range ends the ROM');
  const named = runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_0200, 0x100, 0x0300_0000)] }).proposals;
  assert.deepEqual(named.map((p) => p.name), ['ram_03000000_2', 'ram_03000000_08000300']);
  const adjacent = runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_0280, 0x40, 0x0300_1000), ramRange(0x0800_0200, 0x80, 0x0300_0800)] }).proposals;
  assert.deepEqual(adjacent.map((p) => [p.name, p.start]), [['ram_03000800', 0x0800_0200], ['ram_03001000', 0x0800_0280], ['ram_03000000_080002C0', 0x0800_02c0]], 'two ranges that touch share their border');
});

test('runsAtBorders: a range taking a c module start inside it, or reaching outside the ROM, is E_OVERRIDE_INVALID', () => {
  const modules = [moduleAt('rom_header', 0x0800_0000), moduleAt('main', 0x0800_0100, 'c'), moduleAt('main_2', 0x0800_0400, 'c')];
  const inner = runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_0300, 0x200, 0x0300_0000)] });
  assert.deepEqual(inner.proposals, []);
  assert.deepEqual(inner.refusals.map((d) => [d.code, d.addr, d.span]), [['E_OVERRIDE_INVALID', 0x0800_0300, { start: 0x0800_0300, end: 0x0800_0500 }]]);
  assert.match(inner.refusals[0]?.message ?? '', /the runs_at range \[0x08000300, 0x08000500\) does not start and end on module borders; a range that runs from RAM is its own module, and the c module main_2 starts inside it at 0x08000400/);
  const outside = runsAtBorders(RAM_ROM, { modules, overrides: [ramRange(0x0800_3f00, 0x200, 0x0300_0000)] });
  assert.match(outside.refusals[0]?.message ?? '', /it does not lie inside the ROM/);
});

/** The RAM-copy fixture's init config with its ramCopy range appended, as g6.ram-code-mapped appends it. */
function ramCopyProject(dropData: boolean): { readonly rom: Rom; readonly text: string; readonly config: RomliftConfig } {
  const rom = fixtureRom('code-copied-to-ram');
  const init = configFromDiscover(rom, discover(rom));
  const base = dropData ? { ...init, modules: init.modules.filter((m) => m.kind !== 'data') } : init;
  const config: RomliftConfig = { ...base, overrides: [{ start: 0x0800_012c, size: 0xc, kind: 'code', mode: 'arm', runsAt: 0x0300_0000 }] };
  const text = serializeConfig(config);
  const parsed = parseConfig(text);
  assert.ok(parsed.ok);
  return { rom, text, config: parsed.value };
}

test('the RAM-copy fixture: its range already starts a module, so the code inside it is the only proposal; the model runs it at 0x03000000', () => {
  const { rom, text, config } = ramCopyProject(false);
  assert.ok(config.modules.some((m) => m.start === 0x0800_012c), 'init ends the code before the copied bytes');
  const plan = analyzeUpdate({ rom, configText: text, config });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual(plan.proposals.map((p) => [p.kind, p.kind === 'function' ? p.addr : 0, p.source]), [['function', 0x0800_012c, { kind: 'analysis', rule: 'seed.override' }]]);
  const patched = parseConfig(plan.text);
  assert.ok(patched.ok);
  const model = confirmModel({ rom, config: patched.value }).model;
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.modules.filter((m) => m.runAt !== undefined).map((m) => [m.span, m.runAt]), [[{ start: 0x0800_012c, end: 0x0800_0138 }, 0x0300_0000]]);
  assert.equal(model.functions.find((f) => f.entry === 0x0800_012c)?.runAt, 0x0300_0000);
});

test('a range inside a module: its start border is proposed and patched in as a [[modules]] block, and generate accepts the result', () => {
  const { rom, text, config } = ramCopyProject(true);
  assert.equal(confirmModel({ rom, config }).model.diagnostics.map((d) => d.code).includes('E_OVERRIDE_INVALID'), true, 'off the module borders on disk');
  const plan = analyzeUpdate({ rom, configText: text, config });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual(
    plan.proposals.filter((p) => p.kind === 'module').map((p) => (p.kind === 'module' ? [p.name, p.start, p.moduleKind] : [])),
    [['ram_03000000', 0x0800_012c, 'asm']],
  );
  assert.ok(plan.text.includes('[[modules]]\nname = "ram_03000000"\nstart = 0x0800012C\nkind = "asm"\n\n[functions]'), plan.text);
  const patched = parseConfig(plan.text);
  assert.ok(patched.ok);
  const model = confirmModel({ rom, config: patched.value }).model;
  assert.deepEqual(model.diagnostics, []);
  assert.deepEqual(model.modules.map((m) => [m.name, m.kind, m.runAt]).at(-1), ['ram_03000000', 'asm', 0x0300_0000]);
});

test('a range analyze --update cannot make its own module is refused with E_OVERRIDE_INVALID, and nothing is offered', () => {
  const { rom, config } = ramCopyProject(false);
  const bad: RomliftConfig = { ...config, overrides: [{ start: 0x0800_00f0, size: 0x10, kind: 'code', mode: 'thumb', runsAt: 0x0300_0000 }] };
  const plan = analyzeUpdate({ rom, configText: serializeConfig(bad), config: bad });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.ok ? [] : plan.diagnostics.map((d) => d.code), ['E_OVERRIDE_INVALID']);
});

// ---------------------------------------------------------------------------------------------------
// Signature proposals (phase 6, architecture §7.3, §7.4, D9): libfix's committed golden file on library-game.

const LIBFIX = ((): SignatureFile => {
  const parsed = parseSignatureFile(JSON.parse(readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), 'utf8')));
  assert.ok(parsed.ok);
  return parsed.value;
})();

/** library-game's project as init writes it without a signature file: every default name, [signatures] enabled. */
function gameProject(): { readonly rom: Rom; readonly text: string; readonly config: RomliftConfig } {
  const rom = fixtureRom('library-game');
  const made = initConfigOf(rom);
  assert.ok(made.ok);
  return { rom, text: made.tomlText, config: made.config };
}

function update(rom: Rom, text: string): ReturnType<typeof analyzeUpdate> {
  const parsed = parseConfig(text);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.diagnostics.map((d) => d.message).join('; '));
  return analyzeUpdate({ rom, configText: text, config: parsed.value, signatureFiles: [LIBFIX] });
}

test('signatures: default names are renamed with from, the table added, the missing library module inserted; a second run changes nothing', () => {
  const { rom, text } = gameProject();
  const plan = update(rom, text);
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  assert.ok(plan.changed);
  assert.match(plan.text, /^0x080001B4 = \{ name = "FixMulShift", from = "sig:libfix@1\.0" \}$/m);
  assert.match(plan.text, /^0x08000274 = \{ name = "gFixTable", size = 0x10, type = "pointers", from = "sig:libfix@1\.0" \}$/m);
  assert.match(plan.text, /\[\[modules\]\]\nname = "libfix"\nstart = 0x080001B4\nkind = "asm"\nlibrary = "libfix"\nversion = "1\.0"\n/);
  assert.match(plan.text, /\[\[modules\]\]\nname = "main_08000264"\nstart = 0x08000264\nkind = "c"\n/, 'the c module that held the region resumes after it');
  const modules = plan.proposals.flatMap((p) => (p.kind === 'module' ? [[p.name, p.library?.name]] : []));
  assert.deepEqual(modules, [
    ['libfix', 'libfix'],
    ['main_08000264', undefined],
  ]);
  assert.deepEqual(plan.diagnostics.map((d) => d.code), ['W_SIGNATURE_CONSTANT']);
  const again = update(rom, plan.text);
  assert.ok(again.ok);
  assert.equal(again.changed, false, 'every name is the TOML now, and the module is there');
  assert.deepEqual(again.proposals, []);
});

test('signatures: an entry the user named keeps its name, and [signatures] enabled = false proposes nothing from the files', () => {
  const { rom, text } = gameProject();
  const named = text.replace('0x08000244 = "sub_08000244"', '0x08000244 = "MyAbs"');
  const plan = update(rom, named);
  assert.ok(plan.ok);
  assert.match(plan.text, /^0x08000244 = "MyAbs"$/m);
  assert.ok(!plan.proposals.some((p) => p.kind === 'function' && p.addr === 0x0800_0244));
  const off = update(rom, text.replace('[signatures]\nenabled = true', '[signatures]\nenabled = false'));
  assert.ok(off.ok);
  assert.deepEqual(off.proposals, []);
  assert.equal(off.changed, false);
});

test('signatures: a proposal the config contradicts (a data override over it) is W_EVIDENCE_CONFLICT and changes nothing', () => {
  const { rom, text } = gameProject();
  const overridden = `${text}\n[[overrides]]\nstart = 0x08000244\nsize = 0xE\nkind = "data"\n`;
  const plan = update(rom, overridden);
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  const conflict = plan.diagnostics.find((d) => d.code === 'W_EVIDENCE_CONFLICT');
  assert.ok(conflict !== undefined, plan.diagnostics.map((d) => d.code).join(', '));
  assert.equal(conflict.addr, 0x0800_0244);
  assert.match(conflict.message, /FixAbs as a thumb function at 0x08000244, but .*a data override of romlift\.toml covers \[0x08000244, 0x08000252\)/);
  assert.ok(!plan.proposals.some((p) => p.kind === 'function' && p.addr === 0x0800_0244 && p.name === 'FixAbs'));
  assert.match(plan.text, /^0x080001B4 = \{ name = "FixMulShift", from = "sig:libfix@1\.0" \}$/m, 'the other proposals stand');
});
