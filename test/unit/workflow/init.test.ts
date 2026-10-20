// The init workflow (architecture §2.1, §6.3 to §6.5, D74 c, d), pure, on the committed fixtures: the plan holds the
// canonical TOML that parses back to its config, a decomp.yaml that reads back, the checked tree (c stubs and
// modules.mk included) and the scaffold of templates/MANIFEST.json; the build name follows the header's game code and
// never makes `make` overwrite a ROM; --module-size reaches the module inference; an image that is not a cartridge and
// an invalid --name are refused with nothing planned.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readDecompYaml } from '../../../src/core/config/decomp-yaml.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { BUILD_NAME_SUFFIX, builtRomCollides, init, initBuildName, isExecutableEntry, projectScaffold, scaffoldDrift } from '../../../src/core/workflow/init.ts';
import type { InitInputs } from '../../../src/core/workflow/types.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error(`the package's templates do not read: ${scaffold.diagnostics.map((d) => d.message).join('; ')}`);
const SCAFFOLD = scaffold.value;

function fixtureRom(name: string): Rom {
  const fixture = listSyntheticFixtures().find((f) => f.name === name);
  assert.ok(fixture !== undefined, `fixture ${name}`);
  return readFixtureRom(fixture);
}

function inputs(rom: Rom, over: Partial<InitInputs> = {}): InitInputs {
  return { rom, romFile: 'game.gba', options: {}, templates: SCAFFOLD.templates, romliftVersion: SCAFFOLD.romliftVersion, agbcc: SCAFFOLD.agbcc, ...over };
}

function paths(entries: readonly FileEntry[]): readonly string[] {
  return entries.map((e) => e.path);
}

test('the plan of a fixture: the canonical TOML of its config, decomp.yaml, the checked tree and the scaffold', () => {
  const rom = fixtureRom('far-jump');
  const plan = init(inputs(rom));
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', '));
  // The TOML is the canonical text of the config configFromDiscover builds, and parses back to the plan's config.
  const discovered = configFromDiscover(rom, discover(rom));
  assert.equal(plan.tomlText, serializeConfig({ ...discovered, build: { ...discovered.build, name: plan.config.build.name } }));
  const parsed = parseConfig(plan.tomlText);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, plan.config);
  assert.equal(plan.config.rom.sha1, rom.sha1);
  // decomp.yaml names the TOML, the ROM and the build.
  const yaml = readDecompYaml(plan.decompYamlText);
  assert.ok(yaml.ok);
  assert.deepEqual([yaml.value.config, yaml.value.target, yaml.value.sha1, yaml.value.buildName], ['romlift.toml', 'baserom.gba', rom.sha1, plan.config.build.name]);
  // The tree passed every self-check and holds the C stubs, modules.mk and the linker files.
  assert.ok(plan.result.report.ok);
  for (const path of ['ldscript.txt', 'symbols.ld', 'modules.mk', 'src/main.c']) assert.ok(plan.result.paths.includes(path), path);
  // The scaffold is every manifest target, rendered for the build name; setup.sh alone is executable.
  const name = plan.config.build.name;
  assert.deepEqual(
    [...paths(plan.scaffold)],
    [...SCAFFOLD.templates.manifest.files.map((f) => f.target.replace('@@sha1File@@', `${name}.sha1`))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  assert.deepEqual(plan.scaffold.filter(isExecutableEntry).map((e) => e.path), ['setup.sh']);
  const sha1File = plan.scaffold.find((e) => e.path === `${name}.sha1`);
  assert.equal(sha1File !== undefined && 'text' in sha1File ? sha1File.text : '', `${rom.sha1}  ${name}.gba\n`);
  assert.ok(plan.scaffold.every((e) => e.ownership === 'scaffold'));
  assert.ok(!plan.diagnostics.some((d) => d.severity === 'error'));
});

test('init is deterministic', () => {
  const rom = fixtureRom('composite');
  const a = init(inputs(rom));
  const b = init(inputs(rom));
  assert.ok(a.ok && b.ok);
  assert.equal(a.tomlText, b.tomlText);
  assert.equal(a.decompYamlText, b.decompYamlText);
  assert.deepEqual(a.result.paths, b.result.paths);
  assert.deepEqual(a.scaffold, b.scaffold);
});

test('--module-size reaches the module inference: the composite fixture splits into more modules at 0x200', () => {
  const rom = fixtureRom('composite');
  const small = init(inputs(rom, { options: { moduleSize: 0x200 } }));
  const large = init(inputs(rom));
  assert.ok(small.ok && large.ok);
  assert.ok(small.config.modules.length > large.config.modules.length, `${small.config.modules.length} modules at 0x200, ${large.config.modules.length} by default`);
});

test('the build name: the game code, a suffix when <name>.gba would be the ROM itself, and --name as given', () => {
  const rom = fixtureRom('far-jump');
  const code = rom.header.gameCode.toLowerCase();
  assert.deepEqual(initBuildName(rom, 'game.gba', {}), { ok: true, name: code });
  assert.deepEqual(initBuildName(rom, `${code.toUpperCase()}.GBA`, {}), { ok: true, name: `${code}${BUILD_NAME_SUFFIX}` });
  assert.deepEqual(initBuildName(rom, 'roms/x.gba', { name: 'klonoa-eod' }), { ok: true, name: 'klonoa-eod' });
  assert.ok(builtRomCollides('baserom', 'game.gba'));
  assert.ok(builtRomCollides('game', 'dir/Game.gba'));
  assert.ok(!builtRomCollides('game2', 'game.gba'));
  const plan = init(inputs(rom, { romFile: `${code}.gba` }));
  assert.ok(plan.ok);
  assert.equal(plan.config.build.name, `${code}${BUILD_NAME_SUFFIX}`);
});

test('an invalid or colliding --name is E_NAME_INVALID, and nothing is planned', () => {
  const rom = fixtureRom('far-jump');
  for (const name of ['', 'has space', '-lead', 'a/b', 'baserom', 'game']) {
    const plan = init(inputs(rom, { options: { name } }));
    assert.equal(plan.ok, false, name);
    assert.deepEqual(plan.ok ? [] : plan.diagnostics.map((d) => d.code), ['E_NAME_INVALID'], name);
  }
});

test('an image that is not a cartridge is E_ROM_NOT_GBA, and nothing is planned', () => {
  const rom = romFromBytes(new Uint8Array(0x40), '0'.repeat(40));
  const plan = init(inputs(rom));
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok && plan.diagnostics.every((d) => d.code === 'E_ROM_NOT_GBA'));
});

test('scaffoldDrift: same, differs (with a unified diff) and absent, in entry order', () => {
  const rom = fixtureRom('far-jump');
  const entries = projectScaffold({ name: 'demo', sha1: rom.sha1, title: rom.header.title, ...SCAFFOLD });
  const current = new Map<string, string>();
  for (const e of entries) if ('text' in e) current.set(e.path, e.text);
  current.set('Makefile', `${current.get('Makefile') ?? ''}# mine\n`);
  current.delete('README.md');
  const drift = scaffoldDrift(entries, current);
  assert.deepEqual(drift.map((d) => d.path), paths(entries));
  assert.equal(drift.find((d) => d.path === 'README.md')?.status, 'absent');
  const makefile = drift.find((d) => d.path === 'Makefile');
  assert.equal(makefile?.status, 'differs');
  assert.match(makefile?.diff ?? '', /^--- a\/Makefile\n\+\+\+ b\/Makefile\n@@ .* @@\n/);
  assert.match(makefile?.diff ?? '', /\n-# mine\n$/);
  assert.equal(drift.filter((d) => d.status === 'same').length, entries.length - 2);
});
