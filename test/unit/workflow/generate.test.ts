// The phase-3 generate workflow (architecture §6.4, §9.4, D17, D62 c): the confirm options it builds from a
// config; on every committed fixture, with the config configFromDiscover builds, an ok report (tiling, re-encode,
// module size, text layout, paths) for both printers and the very tree the discover run's model emits; `entries()` re-emits the stream the check pass read; and an image that is
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
import { confirmModel, confirmOptions, generate, listedSeedsOf, overrideFactsOf } from '../../../src/core/workflow/generate.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const NO_C = { defined: new Set<string>() };
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

const MODEL_CHECKS = ['tiling', 'reencode', 'module-size', 'text-layout'];
const fixtures = listSyntheticFixtures();

for (const fixture of fixtures) {
  const rom = readFixtureRom(fixture);
  const found = discover(rom);
  const cfg = configFromDiscover(rom, found);

  for (const printer of PRINTERS) {
    test(`${fixture.name} (${printer}): generate's check pass lays every file out, and entries() re-emits the stream it read`, () => {
      const result = generate({ rom, config: cfg, decomp: NO_C, printer });
      assert.equal(result.analysis.mode, 'confirm');
      const failed = result.report.checks.filter((c) => MODEL_CHECKS.includes(c.id) && !c.ok).map((c) => `${c.id}: ${c.detail}`);
      assert.deepEqual(failed, []);
      assert.deepEqual(
        result.report.checks.map((c) => c.id),
        CHECK_IDS.filter((id) => id !== 'assemble' && id !== 'link'),
      );
      const first = tree(result.entries());
      assert.deepEqual(
        first.map(([path]) => path),
        result.paths,
      );
      assert.deepEqual(tree(result.entries()), first);
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
      else if (JSON.stringify(tree(result.entries())) !== JSON.stringify(tree(emitTree(rom, buildModel(rom, found, cfg), { decomp: NO_C, printer })))) {
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
