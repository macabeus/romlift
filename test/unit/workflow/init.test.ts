// The init workflow (architecture §2.1, §6.3 to §6.5, D74 c, d), pure, on the committed fixtures: the plan holds the
// canonical TOML that parses back to its config, a decomp.yaml that reads back, the checked tree (c stubs and
// modules.mk included) and the scaffold of templates/MANIFEST.json; the build name follows the header's game code and
// never makes `make` overwrite a ROM; --module-size reaches the module inference; an image that is not a cartridge and
// an invalid --name are refused with nothing planned. The directory init is given, as the shell lists it
// (initDirVerdict: absent, empty, the ROM with .git and dot-files, a project; anything else E_DIR_NOT_EMPTY), and the
// files of a project init would replace (replacedProblems), moved here from the shell's read-inputs test
// (architecture-r1-7). From phase 6: the files init owns as data (architecture-a2-6), no library named and no
// diagnostic of the plan when the shell found no signature file (W_SIGNATURES_ABSENT is the shell's), --no-signatures,
// and the checked plan of library-game with libfix's file and with a member that restores an extent (the fold's names,
// size and labels pass every self-check).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { readDecompYaml } from '../../../src/core/config/decomp-yaml.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { BUILD_NAME_SUFFIX, builtRomCollides, initBuildName } from '../../../src/core/workflow/init-config.ts';
import { init, initDirVerdict, replacedProblems, wantsLockStep } from '../../../src/core/workflow/init.ts';
import type { InitDirListing } from '../../../src/core/workflow/init.ts';
import type { InitInputs } from '../../../src/core/workflow/types.ts';
import type { DiskFileState } from '../../../src/core/write-plan/types.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { signatureFile } from '../../helpers/signatures.ts';

const scaffold = await readScaffoldInputs();
if (!scaffold.ok)
  throw new Error(`the package's templates do not read: ${scaffold.diagnostics.map((d) => d.message).join('; ')}`);
const SCAFFOLD = scaffold.value;

function fixtureRom(name: string): Rom {
  const fixture = listSyntheticFixtures().find((f) => f.name === name);
  assert.ok(fixture !== undefined, `fixture ${name}`);
  return readFixtureRom(fixture);
}

function inputs(rom: Rom, over: Partial<InitInputs> = {}): InitInputs {
  return {
    rom,
    romFile: 'game.gba',
    options: {},
    templates: SCAFFOLD.templates,
    romliftVersion: SCAFFOLD.romliftVersion,
    agbcc: SCAFFOLD.agbcc,
    ...over,
  };
}

function paths(entries: readonly FileEntry[]): readonly string[] {
  return entries.map((e) => e.path);
}

test('the plan of a fixture: the canonical TOML of its config, decomp.yaml, the checked tree and the scaffold', () => {
  const rom = fixtureRom('far-jump');
  const plan = init(inputs(rom));
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', '));
  // The TOML is the canonical text of the config configFromDiscover builds, with the signature layer enabled (no
  // file was looked for, so no library is named and no W_SIGNATURES_ABSENT), and parses back to the plan's config.
  const discovered = configFromDiscover(rom, discover(rom));
  assert.equal(
    plan.tomlText,
    serializeConfig({
      ...discovered,
      build: { ...discovered.build, name: plan.config.build.name },
      signatures: { enabled: true },
    }),
  );
  assert.ok(!plan.diagnostics.some((d) => d.code === 'W_SIGNATURES_ABSENT'));
  // The files init owns, as data (architecture-a2-6): romlift.toml and decomp.yaml with their texts, the ROM's copy.
  assert.deepEqual(
    plan.files.map(([path]) => path),
    ['romlift.toml', 'decomp.yaml'],
  );
  assert.equal(plan.files[0]?.[1], plan.tomlText);
  assert.equal(plan.romCopy, 'baserom.gba');
  const parsed = parseConfig(plan.tomlText);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value, plan.config);
  assert.equal(plan.config.rom.sha1, rom.sha1);
  // decomp.yaml names the TOML, the ROM and the build.
  const yaml = readDecompYaml(plan.files[1]?.[1] ?? '');
  assert.ok(yaml.ok);
  assert.deepEqual(
    [yaml.value.config, yaml.value.target, yaml.value.sha1, yaml.value.buildName],
    ['romlift.toml', 'baserom.gba', rom.sha1, plan.config.build.name],
  );
  // The tree passed every self-check and holds the C stubs, modules.mk and the linker files.
  assert.ok(plan.result.report.ok);
  for (const path of ['ldscript.txt', 'symbols.ld', 'modules.mk', 'src/main.c'])
    assert.ok(plan.result.paths.includes(path), path);
  // The scaffold is every manifest target, rendered for the build name; setup.sh alone is executable.
  const name = plan.config.build.name;
  assert.deepEqual(
    [...paths(plan.scaffold)],
    [...SCAFFOLD.templates.manifest.files.map((f) => f.target.replace('@@sha1File@@', `${name}.sha1`))].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  );
  assert.deepEqual(
    plan.scaffold.filter((e) => e.ownership === 'scaffold' && e.executable === true).map((e) => e.path),
    ['setup.sh'],
  );
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
  assert.deepEqual(a.files, b.files);
  assert.deepEqual(a.result.paths, b.result.paths);
  assert.deepEqual(a.scaffold, b.scaffold);
});

test('--module-size reaches the module inference: the composite fixture splits into more modules at 0x200', () => {
  const rom = fixtureRom('composite');
  const small = init(inputs(rom, { options: { moduleSize: 0x200 } }));
  const large = init(inputs(rom));
  assert.ok(small.ok && large.ok);
  assert.ok(
    small.config.modules.length > large.config.modules.length,
    `${small.config.modules.length} modules at 0x200, ${large.config.modules.length} by default`,
  );
});

test('the build name: the game code, a suffix when <name>.gba would be the ROM itself, and --name as given', () => {
  const rom = fixtureRom('far-jump');
  const code = rom.header.gameCode.toLowerCase();
  assert.deepEqual(initBuildName(rom, 'game.gba', {}), { ok: true, name: code });
  assert.deepEqual(initBuildName(rom, `${code.toUpperCase()}.GBA`, {}), {
    ok: true,
    name: `${code}${BUILD_NAME_SUFFIX}`,
  });
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

test('wantsLockStep: only after a write without an error, and only while no package-lock.json exists', () => {
  const warning = { code: 'W_X', severity: 'warning', message: '' } as const;
  const error = { code: 'E_X', severity: 'error', message: '' } as const;
  assert.equal(wantsLockStep([warning], false), true);
  assert.equal(wantsLockStep([warning], true), false);
  assert.equal(wantsLockStep([error], false), false);
});

test('initDirVerdict: absent, empty, or the ROM with .git and dot-files is accepted; another entry or a file is E_DIR_NOT_EMPTY', () => {
  const at = (over: Partial<InitDirListing>): InitDirListing => ({
    dir: '/work/game',
    state: 'directory',
    names: [],
    ...over,
  });
  assert.deepEqual(initDirVerdict(at({ state: 'absent' })), { ok: true });
  assert.deepEqual(initDirVerdict(at({})), { ok: true });
  assert.deepEqual(initDirVerdict(at({ romInside: 'game.gba', names: ['.DS_Store', '.git', 'game.gba'] })), {
    ok: true,
  });
  const refused = initDirVerdict(at({ romInside: 'game.gba', names: ['another.gba', 'game.gba'] }));
  assert.ok(!refused.ok);
  assert.deepEqual(
    refused.diagnostics.map((d) => [d.code, d.path]),
    [['E_DIR_NOT_EMPTY', '/work/game']],
  );
  assert.match(refused.diagnostics[0]?.message ?? '', /another\.gba/);
  assert.doesNotMatch(refused.diagnostics[0]?.message ?? '', /holds [^;]*\bgame\.gba/, 'the ROM itself is not named');
  const many = initDirVerdict(at({ names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }));
  assert.ok(!many.ok);
  assert.match(many.diagnostics[0]?.message ?? '', /a, b, c, d, e, … \(7 in all\)/);
  const file = initDirVerdict(at({ state: 'not-directory' }));
  assert.ok(!file.ok);
  assert.deepEqual(
    file.diagnostics.map((d) => d.code),
    ['E_DIR_NOT_EMPTY'],
  );
});

test('initDirVerdict: a romlift project is accepted whatever else it holds', () => {
  const names = ['Makefile', 'asm', 'baserom.gba', 'decomp.yaml', 'romlift.toml', 'src'];
  assert.deepEqual(initDirVerdict({ dir: '/work/game', state: 'directory', names, romInside: 'baserom.gba' }), {
    ok: true,
  });
  assert.deepEqual(initDirVerdict({ dir: '/work/game', state: 'directory', names: ['.romlift', 'notes.txt'] }), {
    ok: true,
  });
});

test('replacedProblems: absent, unlisted and equal files are fine; another romlift.toml or another ROM is E_DIR_NOT_EMPTY', () => {
  const current: ReadonlyMap<string, DiskFileState> = new Map<string, DiskFileState>([
    ['romlift.toml', { kind: 'present', sha1: 'toml-1' }],
    ['decomp.yaml', { kind: 'absent' }],
    ['baserom.gba', { kind: 'present', sha1: 'rom' }],
  ]);
  const same = new Map([
    ['romlift.toml', 'toml-1'],
    ['decomp.yaml', 'yaml'],
    ['baserom.gba', 'rom'],
    ['unlisted.txt', 'x'],
  ]);
  assert.deepEqual(replacedProblems('/work/game', same, current), []);
  const other = new Map([
    ['romlift.toml', 'toml-2'],
    ['baserom.gba', 'mor'],
  ]);
  const problems = replacedProblems('/work/game', other, current);
  assert.deepEqual(
    problems.map((d) => [d.code, d.path]),
    [
      ['E_DIR_NOT_EMPTY', 'romlift.toml'],
      ['E_DIR_NOT_EMPTY', 'baserom.gba'],
    ],
  );
  assert.match(problems[0]?.message ?? '', /romlift generate/);
  assert.match(problems[1]?.message ?? '', /another ROM/);
});

test("no signature file found: the plan names no library and raises nothing (W_SIGNATURES_ABSENT is the shell's); --no-signatures: enabled = false", () => {
  const rom = fixtureRom('far-jump');
  const codes = (over: Partial<InitInputs>): readonly string[] => {
    const plan = init(inputs(rom, over));
    assert.ok(plan.ok);
    return plan.diagnostics.map((d) => d.code);
  };
  assert.ok(!codes({ signatureFiles: [] }).some((c) => c.startsWith('W_SIGNATURE')));
  assert.ok(!codes({}).includes('W_SIGNATURES_ABSENT'));
  assert.ok(!codes({ signatureFiles: [], options: { signatures: false } }).includes('W_SIGNATURES_ABSENT'));
  const off = init(inputs(rom, { signatureFiles: [], options: { signatures: false } }));
  assert.ok(off.ok);
  assert.deepEqual(off.config.signatures, { enabled: false });
  assert.match(off.tomlText, /\[signatures\]\nenabled = false\n/);
});

test("library-game with libfix's file, and with a member that restores an extent: the plans pass every self-check", () => {
  const rom = fixtureRom('library-game');
  const golden = parseSignatureFile(
    JSON.parse(readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), 'utf8')),
  );
  assert.ok(golden.ok);
  const plan = init(inputs(rom, { signatureFiles: [golden.value] }));
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', '));
  assert.ok(plan.result.report.ok);
  assert.ok(
    plan.result.model.modules.some((m) => m.name === 'libfix' && m.kind === 'asm' && m.library?.name === 'libfix'),
  );
  assert.ok(plan.result.model.functions.some((f) => f.name === 'FixMulShift' && f.source.name.kind === 'toml'));
  const pair = signatureFile('gamelib', {
    id: '1',
    members: [{ name: 'GamePair', bytes: rom.bytes.slice(0x154, 0x160) }],
  });
  const restored = init(inputs(rom, { signatureFiles: [pair] }));
  assert.ok(restored.ok, restored.ok ? '' : restored.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  assert.ok(restored.result.report.ok);
  const fn = restored.result.model.functions.find((f) => f.name === 'GamePair');
  assert.deepEqual(fn?.extent, { start: 0x0800_0154, end: 0x0800_0160 });
  assert.equal(fn?.source.extent, 'toml-size');
  assert.ok(
    restored.result.model.chunks.some(
      (c) => c.name === 'GamePair' && c.innerLabels.some((l) => l.addr === 0x0800_015c),
    ),
  );
});
