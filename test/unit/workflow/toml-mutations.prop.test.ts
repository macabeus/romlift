// Seeded TOML mutations, pure (architecture §6.2, §6.5, §10 "Property", roadmap 4.E): on every committed fixture,
// the config configFromDiscover builds is edited at random, legally, one edit at a time, serialised with
// serializeConfig and parsed back with parseConfig; then the pure generate path (the confirm analysis and
// buildModel, verifyModel, and checkEntries over the emission stream) must pass with no error diagnostic. The
// illegal edits give their documented codes: a module start moved by 2 bytes (E_MODULE_BORDER, from buildModel),
// a repeated [functions] line (E_DUPLICATE_ADDRESS) and a [functions] key of seven hex digits (E_TOML_KEY_SPELLING),
// both from parseConfig. The legal edits are g4.toml-mutations' five, which that gate then links with the toolchain:
// move a `c` module's start to another legal border between its neighbours, rename a function that still has its
// default name, delete a listed function that starts no module (always the last one too, whose deletion moves the
// confirm run's data start below the data module's start, which stays legal, D75 a), add a `code` override that covers one found function
// exactly, and split a `c` module at a legal border inside it. No toolchain, no file; the seed is fixed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import type { ModuleConfig, OverrideConfig, RomliftConfig } from '../../../src/core/config/schema.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { legalBorders } from '../../../src/core/layout/borders.ts';
import { defaultFunctionName } from '../../../src/foundation/util/project-files.ts';
import { combineReports } from '../../../src/core/verify/report.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { verifyModel } from '../../../src/core/verify/tiling.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import type { Addr } from '../../../src/foundation/rom/span.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { xorshift32 } from '../../helpers/prng.ts';

/** The seed every run starts from (g4.toml-mutations' seed); each fixture's own seed mixes in its name. */
const SEED = 0x6734_0001;
/** How many edits of each legal kind are drawn per fixture (fewer when the config offers fewer places). */
const EDITS_PER_KIND = 3;

const LEGAL_KINDS = ['move-start', 'rename', 'delete-function', 'add-override', 'split-module'] as const;
type LegalKind = (typeof LEGAL_KINDS)[number];

/** A [functions] line in serializeConfig's layout whose key starts with 0x0: the seven-digit spelling drops that 0. */
const FUNCTION_LINE = /^0x0([0-9A-F]{7})(\s*=.*)$/;

interface Facts {
  readonly rom: Rom;
  readonly config: RomliftConfig;
  readonly discovered: AnalysisResult;
  readonly borders: readonly Addr[];
}

interface Edit {
  readonly what: string;
  readonly config: RomliftConfig;
}

const hex = (a: Addr): string => a.toString(16).toUpperCase().padStart(8, '0');

/** A seeded draw over xorshift32 (test/helpers/prng.ts). */
interface Draw {
  below(n: number): number;
}

function drawFrom(seed: number): Draw {
  let state = seed === 0 ? 1 : seed >>> 0;
  return {
    below(n: number): number {
      state = xorshift32(state);
      return state % n;
    },
  };
}

/** FNV-1a of `name` over SEED: the fixture's own seed, so adding a fixture leaves the others' edits unchanged. */
function seedOf(name: string): number {
  let h = SEED;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x0100_0193) >>> 0;
  return h === 0 ? 1 : h;
}

/** Up to `count` distinct items of `options`, drawn in order. */
function drawSome<T>(draw: Draw, options: readonly T[], count: number): T[] {
  const pool = [...options];
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const [item] = pool.splice(draw.below(pool.length), 1);
    if (item !== undefined) out.push(item);
  }
  return out;
}

const byNumber = (a: number, b: number): number => a - b;

/** The legal edits of `kind` the config offers, up to EDITS_PER_KIND of them, each applied alone to the original. */
function legalEdits(kind: LegalKind, facts: Facts, draw: Draw): readonly Edit[] {
  const { config, borders } = facts;
  const modules = config.modules;
  const starts = new Set(modules.map((m) => m.start));
  const nextStart = (i: number): Addr => modules[i + 1]?.start ?? facts.rom.end;
  const cModules = modules.flatMap((m, i) => (m.kind === 'c' && i > 0 ? [{ m, i }] : []));
  switch (kind) {
    case 'move-start': {
      const options = cModules.flatMap(({ m, i }) => borders.filter((b) => b > (modules[i - 1]?.start ?? facts.rom.base) && b < nextStart(i) && b !== m.start).map((b) => ({ m, i, b })));
      return drawSome(draw, options, EDITS_PER_KIND).map(({ m, i, b }) => ({
        what: `move ${m.name} from 0x${hex(m.start)} to 0x${hex(b)}`,
        config: { ...config, modules: modules.map((x, j) => (j === i ? { ...x, start: b } : x)) },
      }));
    }
    case 'rename': {
      const entries = [...config.functions.keys()].sort(byNumber).filter((a) => config.functions.get(a)?.name === defaultFunctionName(a));
      return drawSome(draw, entries, EDITS_PER_KIND).flatMap((addr) => {
        const fn = config.functions.get(addr);
        if (fn === undefined) return [];
        const functions = new Map(config.functions);
        functions.set(addr, { ...fn, name: `Mutated_${hex(addr)}` });
        return [{ what: `rename ${fn.name} to Mutated_${hex(addr)}`, config: { ...config, functions } }];
      });
    }
    case 'delete-function': {
      // The last listed function always among them: deleting it moves the confirm run's code end, and with it the
      // data start, below the data module's start, which stays a legal border (D75 a).
      const listed = [...config.functions.keys()].sort(byNumber);
      const last = listed[listed.length - 1];
      const entries = listed.filter((a) => !starts.has(a) && a !== last);
      const drawn = drawSome(draw, entries, EDITS_PER_KIND);
      const chosen = last !== undefined && !starts.has(last) ? [...drawn, last] : drawn;
      return chosen.map((addr) => {
        const functions = new Map(config.functions);
        functions.delete(addr);
        return { what: `delete the [functions] entry 0x${hex(addr)}`, config: { ...config, functions } };
      });
    }
    case 'add-override': {
      const free = facts.discovered.functions.filter(
        (f) => config.functions.has(f.entry) && !config.overrides.some((o) => o.start < f.extent.end && f.extent.start < o.start + o.size),
      );
      return drawSome(draw, free, EDITS_PER_KIND).map((f) => {
        const override: OverrideConfig = { start: f.extent.start, size: f.extent.end - f.extent.start, kind: 'code', mode: f.mode };
        return {
          what: `a code override over 0x${hex(f.extent.start)}..0x${hex(f.extent.end)} (${f.mode})`,
          config: { ...config, overrides: [...config.overrides, override].sort((a, b) => a.start - b.start) },
        };
      });
    }
    case 'split-module': {
      const options = cModules.flatMap(({ m, i }) => borders.filter((b) => b > m.start && b < nextStart(i) && !starts.has(b)).map((b) => ({ m, i, b })));
      return drawSome(draw, options, EDITS_PER_KIND).map(({ m, i, b }) => {
        const added: ModuleConfig = { ...m, name: `${m.name}_split_${hex(b)}`, start: b };
        return { what: `split ${m.name} at 0x${hex(b)}`, config: { ...config, modules: [...modules.slice(0, i + 1), added, ...modules.slice(i + 1)] } };
      });
    }
  }
}

/** The text through the TOML: serialised, then parsed back; a parse failure is a failed assertion. */
function throughToml(config: RomliftConfig, what: string): RomliftConfig {
  const parsed = parseConfig(serializeConfig(config));
  if (!parsed.ok) assert.fail(`${what}: the serialised config does not parse: ${parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  return parsed.value;
}

/** What the pure generate path finds wrong with `config`: the error diagnostics and the failed checks. */
function generateProblems(rom: Rom, config: RomliftConfig): readonly string[] {
  const { analysis, model } = confirmModel({ rom, config });
  const report = combineReports(verifyModel(rom, model), checkEntries(rom, model, emitTree(rom, model, { decomp: { defined: [] }, printer: 'readable' })));
  const errors = [...analysis.diagnostics, ...model.diagnostics].filter((d) => d.severity === 'error').map((d) => `${d.code}: ${d.message}`);
  const failed = report.checks.filter((c) => !c.ok).map((c) => `check ${c.id}: ${c.detail}`);
  return [...errors, ...failed];
}

/** The model's error codes for `config` (the confirm analysis and buildModel). */
function modelErrorCodes(rom: Rom, config: RomliftConfig): readonly string[] {
  const { analysis, model } = confirmModel({ rom, config });
  return [...analysis.diagnostics, ...model.diagnostics].filter((d) => d.severity === 'error').map((d) => d.code);
}

const fixtures = listSyntheticFixtures();
const legalCounts = new Map<LegalKind, number>(LEGAL_KINDS.map((k) => [k, 0]));

function factsOf(rom: Rom): Facts {
  const discovered = discover(rom);
  return { rom, discovered, config: configFromDiscover(rom, discovered), borders: legalBorders(rom, discovered) };
}

for (const fixture of fixtures) {
  test(`${fixture.name}: seeded legal TOML edits keep the pure generate path green, and the illegal ones give their codes`, () => {
    const rom = readFixtureRom(fixture);
    const facts = factsOf(rom);
    const text = serializeConfig(facts.config);
    const original = parseConfig(text);
    assert.ok(original.ok, `${fixture.name}: configFromDiscover's config does not round-trip through the TOML`);
    assert.deepEqual(original.value, facts.config, 'parseConfig(serializeConfig(config)) is the config');
    assert.deepEqual(generateProblems(rom, original.value), [], 'the unedited config passes');

    const draw = drawFrom(seedOf(fixture.name));
    for (const kind of LEGAL_KINDS) {
      for (const edit of legalEdits(kind, facts, draw)) {
        const config = throughToml(edit.config, edit.what);
        assert.deepEqual(config, edit.config, `${edit.what}: the TOML round trip keeps the edit`);
        assert.deepEqual(generateProblems(rom, config), [], `${fixture.name}: ${edit.what}`);
        legalCounts.set(kind, (legalCounts.get(kind) ?? 0) + 1);
      }
    }

    // A `c` module's start moved by 2 bytes is never a legal border (borders rest on the ARM word, D63).
    const moved = facts.config.modules.findIndex((m, i) => i > 0 && m.kind === 'c' && !facts.borders.includes(m.start + 2));
    const module = facts.config.modules[moved];
    if (module !== undefined) {
      const illegal = { ...facts.config, modules: facts.config.modules.map((m, i) => (i === moved ? { ...m, start: m.start + 2 } : m)) };
      const codes = modelErrorCodes(rom, throughToml(illegal, `${module.name} start + 2`));
      assert.ok(codes.includes('E_MODULE_BORDER'), `${module.name} at 0x${hex(module.start + 2)} gave [${codes.join(', ')}], expected E_MODULE_BORDER`);
    }

    const lines = text.split('\n');
    const header = lines.indexOf('[functions]');
    const at = lines.findIndex((l, i) => i > header && FUNCTION_LINE.test(l));
    const line = lines[at];
    assert.ok(header >= 0 && line !== undefined, 'the canonical TOML has a [functions] entry');
    const repeated = parseConfig([...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join('\n'));
    assert.equal(repeated.ok, false, 'a repeated [functions] line is refused');
    assert.ok(repeated.diagnostics.some((d) => d.code === 'E_DUPLICATE_ADDRESS'), `a repeated line gave [${repeated.diagnostics.map((d) => d.code).join(', ')}]`);
    const sevenDigits = parseConfig([...lines.slice(0, at), line.replace(FUNCTION_LINE, '0x$1$2'), ...lines.slice(at + 1)].join('\n'));
    assert.equal(sevenDigits.ok, false, 'a seven-digit key is refused');
    assert.ok(sevenDigits.diagnostics.some((d) => d.code === 'E_TOML_KEY_SPELLING'), `a seven-digit key gave [${sevenDigits.diagnostics.map((d) => d.code).join(', ')}]`);
  });
}

test('every legal edit kind ran on at least one fixture, and the composite offers each one', () => {
  assert.ok(fixtures.length > 0, 'no committed fixture');
  const none = LEGAL_KINDS.filter((k) => (legalCounts.get(k) ?? 0) === 0);
  assert.deepEqual(none, [], `edit kinds no fixture offered a place for: ${none.join(', ')}`);
  const composite = fixtures.find((f) => f.name === 'composite');
  assert.ok(composite !== undefined, 'the composite fixture is committed');
  const facts = factsOf(readFixtureRom(composite));
  const missing = LEGAL_KINDS.filter((k) => legalEdits(k, facts, drawFrom(SEED)).length === 0);
  assert.deepEqual(missing, [], 'the composite offers every legal edit');
});
