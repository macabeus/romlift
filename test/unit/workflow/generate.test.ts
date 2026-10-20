// The phase-3 generate workflow (architecture §6.4, §9.4, D17, D62 c): the confirm options it builds from a
// config; on every committed fixture, with the config configFromDiscover builds, an ok report (tiling, re-encode,
// module size, text layout, paths) for both printers and the very tree the discover run's model emits; generatedEntries re-emits the stream the check pass read; and an image that is
// not a cartridge is a diagnostic, never a throw.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import type { FileEntry, Printer } from '../../../src/core/emit/tree.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { CHECK_IDS } from '../../../src/core/verify/report.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import {
  confirmModel,
  confirmOptions,
  generate,
  generatedEntries,
  listedSeedsOf,
  overrideFactsOf,
  writable,
} from '../../../src/core/workflow/generate.ts';
import { generateFromRom, initConfigOf, initModel } from '../../../src/core/workflow/init-config.ts';
import { retainedPrefixes } from '../../../src/core/model/paths.ts';
import { freshTreePlanInputs } from '../../../src/core/write-plan/project-plan.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const NO_C = { defined: [] };
const PRINTERS: readonly Printer[] = ['readable', 'raw'];
const SHA1 = '0123456789abcdef0123456789abcdef01234567';

function config(over: Partial<RomliftConfig> = {}): RomliftConfig {
  return {
    schema: 1,
    rom: { path: 'baserom.gba', sha1: SHA1 },
    build: { name: 'rom', compiler: 'agbcc' },
    signatures: { enabled: false },
    modules: [],
    functions: new Map(),
    symbols: new Map(),
    overrides: [],
    ...over,
  };
}

/** What a parity comparison of two runs looks at: each function's entry, mode and extent. */
function shape(a: AnalysisResult): string {
  return JSON.stringify(a.functions.map((f) => [f.entry, f.mode, f.extent.start, f.extent.end]));
}

function text(e: FileEntry): string {
  return 'text' in e ? e.text : JSON.stringify(e.edits);
}

function tree(entries: Iterable<FileEntry>): readonly (readonly [string, string])[] {
  return [...entries].map((e) => [e.path, text(e)] as const);
}

test('confirmOptions lists every [functions] entry as seed.listed with name, size and label, by address, and the overrides', () => {
  const c = config({
    functions: new Map([
      [0x0800_0200, { name: 'Later', mode: 'arm' as const, aliases: [], size: 0x10 }],
      [0x0800_0100, { name: 'First', mode: 'thumb' as const, aliases: ['Alias'] }],
      [0x0800_0104, { name: 'Inner', mode: 'thumb' as const, aliases: [], label: true }],
    ]),
    overrides: [{ start: 0x0800_0300, size: 0x20, kind: 'code', mode: 'thumb', runsAt: 0x0300_0000 }, { start: 0x0800_0400, size: 4, kind: 'data' }],
  });
  assert.deepEqual(listedSeedsOf(c), [
    { entry: 0x0800_0100, mode: 'thumb', rule: 'seed.listed', name: 'First' },
    { entry: 0x0800_0104, mode: 'thumb', rule: 'seed.listed', name: 'Inner', label: true },
    { entry: 0x0800_0200, mode: 'arm', rule: 'seed.listed', name: 'Later', size: 0x10 },
  ]);
  assert.deepEqual(overrideFactsOf(c), [
    { span: { start: 0x0800_0300, end: 0x0800_0320 }, kind: 'code', mode: 'thumb', runsAt: 0x0300_0000 },
    { span: { start: 0x0800_0400, end: 0x0800_0404 }, kind: 'data' },
  ]);
  const options = confirmOptions(c);
  assert.equal(options.mode, 'confirm');
  assert.equal(options.trail, 'off');
  assert.deepEqual(options.seeds, listedSeedsOf(c));
  assert.deepEqual(options.overrides, overrideFactsOf(c));
});

test('listedSeedsOf validates exactly the entries with `from` (another source\'s proposal), not those the analysis or a person wrote', () => {
  const c = config({
    functions: new Map([
      [0x0800_0100, { name: 'Found', mode: 'thumb' as const, aliases: [] }],
      [0x0800_0104, { name: 'Legacy', mode: 'thumb' as const, aliases: [], from: 'legacy' }],
      [0x0800_0108, { name: 'SoundMain', mode: 'arm' as const, aliases: [], size: 0x10, from: 'sig:m4a@2001' }],
      [0x0800_0118, { name: 'Inner', mode: 'thumb' as const, aliases: [], label: true, from: 'evidence:trace' }],
    ]),
  });
  assert.deepEqual(listedSeedsOf(c), [
    { entry: 0x0800_0100, mode: 'thumb', rule: 'seed.listed', name: 'Found' },
    { entry: 0x0800_0104, mode: 'thumb', rule: 'seed.listed', name: 'Legacy', validate: true },
    { entry: 0x0800_0108, mode: 'arm', rule: 'seed.listed', name: 'SoundMain', size: 0x10, validate: true },
    { entry: 0x0800_0118, mode: 'thumb', rule: 'seed.listed', name: 'Inner', label: true, validate: true },
  ]);
  assert.equal(Object.hasOwn(listedSeedsOf(c)[0] ?? {}, 'validate'), false, 'no member at all without `from`');
});

const MODEL_CHECKS = ['tiling', 'reencode', 'module-size', 'text-layout'];
const fixtures = listSyntheticFixtures();

for (const fixture of fixtures) {
  const rom = readFixtureRom(fixture);
  const found = discover(rom);
  const cfg = configFromDiscover(rom, found);

  for (const printer of PRINTERS) {
    test(`${fixture.name} (${printer}): generate's check pass lays every file out, and generatedEntries re-emits the stream it read`, () => {
      const result = generate({ rom, config: cfg, decomp: NO_C, printer });
      assert.equal(result.analysis.mode, 'confirm');
      const failed = result.report.checks.filter((c) => MODEL_CHECKS.includes(c.id) && !c.ok).map((c) => `${c.id}: ${c.detail}`);
      assert.deepEqual(failed, []);
      assert.deepEqual(
        result.report.checks.map((c) => c.id),
        CHECK_IDS.filter((id) => id !== 'assemble' && id !== 'link'),
      );
      const first = tree(generatedEntries(rom, result));
      assert.deepEqual(
        first.map(([path]) => path),
        result.paths,
      );
      assert.deepEqual(tree(generatedEntries(rom, result)), first);
    });
  }
}

test('on every fixture the report is ok with no error diagnostic, and the tree is the one of the discover run', () => {
  const problems: string[] = [];
  for (const fixture of fixtures) {
    const rom = readFixtureRom(fixture);
    const found = discover(rom);
    const cfg = configFromDiscover(rom, found);
    for (const printer of PRINTERS) {
      const result = generate({ rom, config: cfg, decomp: NO_C, printer });
      const failed = result.report.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
      const errors = result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
      if (failed.length + errors.length > 0) problems.push(`${fixture.name} ${printer}: ${[...failed, ...errors].join('; ')}`);
      // Confirm equals discover: the tree is the one the discover run's own model emits.
      if (shape(result.analysis) !== shape(found)) problems.push(`${fixture.name}: the confirm run differs from discover`);
      else if (JSON.stringify(tree(generatedEntries(rom, result))) !== JSON.stringify(tree(emitTree(rom, buildModel(rom, found, cfg), { decomp: NO_C, printer })))) {
        problems.push(`${fixture.name} ${printer}: the tree differs from the discover run's`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('confirmModel is the analysis and model generate checks', () => {
  const fixture = fixtures.find((f) => f.name === 'far-jump');
  assert.ok(fixture !== undefined);
  const rom = readFixtureRom(fixture);
  const cfg = configFromDiscover(rom, discover(rom));
  const confirmed = confirmModel({ rom, config: cfg });
  const generated = generate({ rom, config: cfg, decomp: NO_C, printer: 'readable' });
  assert.deepEqual(confirmed.analysis, generated.analysis);
  assert.deepEqual(confirmed.model.chunks, generated.model.chunks);
});

test('an image that is not a cartridge gives E_ROM_NOT_GBA and an empty confirm analysis, never a throw', () => {
  const bytes = Uint8Array.from({ length: 0x30 }, (_, i) => (i * 7) & 0xff);
  const rom = romFromBytes(bytes, SHA1);
  const result = generate({ rom, config: config(), decomp: NO_C, printer: 'readable' });
  assert.equal(result.analysis.mode, 'confirm');
  assert.deepEqual(result.analysis.functions, []);
  assert.ok(result.diagnostics.some((d) => d.code === 'E_ROM_NOT_GBA'));
});

test('a generate result is plain data: no function anywhere in it (D19)', () => {
  const fixture = fixtures.find((f) => f.name === 'far-jump');
  assert.ok(fixture !== undefined);
  const rom = readFixtureRom(fixture);
  const result = generate({ rom, config: configFromDiscover(rom, discover(rom)), decomp: NO_C, printer: 'readable' });
  const seen = new Set<unknown>();
  const visit = (value: unknown, path: string): void => {
    assert.notEqual(typeof value, 'function', path);
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) return;
    const members = value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value].map((v, i) => [i, v] as const) : Object.entries(value);
    for (const [k, v] of members) visit(v, `${path}.${String(k)}`);
  };
  visit(result, 'result');
  // Every field but the model (whose item table is typed arrays) survives a JSON round trip unchanged: nothing a
  // codec would drop, such as a Set or a Map (architecture §3, architecture-r1-12).
  const { model: _model, ...rest } = result;
  assert.deepEqual(JSON.parse(JSON.stringify(rest)) as unknown, rest);
  assert.deepEqual(JSON.parse(JSON.stringify(result.cx)) as unknown, { decomp: { defined: [] }, printer: 'readable' });
});

test('initConfigOf, initModel and generateFromRom: the config configFromDiscover builds, named and parsed back as init writes it, refused on a discover error', () => {
  const fixture = fixtures.find((f) => f.name === 'far-jump');
  assert.ok(fixture !== undefined);
  const rom = readFixtureRom(fixture);
  const found = discover(rom);
  const init = initConfigOf(rom);
  assert.ok(init.ok);
  const built = configFromDiscover(rom, found);
  assert.deepEqual(init.config, { ...built, build: { ...built.build, name: init.config.build.name } });
  const sized = initConfigOf(rom, { moduleSize: 0x40, name: 'named' });
  assert.ok(sized.ok);
  assert.equal(sized.config.build.name, 'named');
  assert.deepEqual(sized.config.modules, configFromDiscover(rom, found, { moduleSize: 0x40 }).modules, 'the --module-size init passes');
  const model = initModel(rom);
  assert.ok(model.ok);
  assert.deepEqual(model.model, confirmModel({ rom, config: init.config }).model);
  const generated = generateFromRom(rom, { decomp: NO_C, printer: 'raw' });
  assert.ok(generated.ok);
  assert.equal(writable(generated), true);
  const bytes = Uint8Array.from({ length: 0x30 }, (_, i) => (i * 7) & 0xff);
  const notGba = romFromBytes(bytes, SHA1);
  for (const refused of [initConfigOf(notGba), initModel(notGba), generateFromRom(notGba, { decomp: NO_C, printer: 'readable' })]) {
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.diagnostics.some((d) => d.code === 'E_ROM_NOT_GBA'));
  }
});

test('freshTreePlanInputs: no manifest, every path absent, no reconciled text, the non-generated modules retained', () => {
  const fixture = fixtures.find((f) => f.name === 'far-jump');
  assert.ok(fixture !== undefined);
  const rom = readFixtureRom(fixture);
  const result = generate({ rom, config: configFromDiscover(rom, discover(rom)), decomp: NO_C, printer: 'readable' });
  const kept = { ...result.model, modules: result.model.modules.map((m, i) => (i === 1 ? { ...m, generated: false } : m)) };
  const inputs = freshTreePlanInputs(generatedEntries(rom, result), result.paths, (t) => String(t.length), retainedPrefixes(kept));
  assert.equal(inputs.manifest, null);
  assert.deepEqual([...inputs.disk.values()].every((v) => v === 'absent'), true);
  assert.deepEqual([...inputs.disk.keys()], result.paths);
  assert.equal(inputs.reconciledTexts.size, 0);
  assert.ok(inputs.retained.length > 0);
  assert.equal(inputs.hash('abc'), '3');
});
