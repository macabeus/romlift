// configFromDiscover (architecture §6.1, §6.2, D62 c): every found entry listed with its mode and default name,
// nested entries as labels; the inferred modules, the agbcc-shaped ones without a library 'c' since phase 4 (D62 c),
// the header, startup, asm-only and library ones 'asm'; the build name from the header's game code and never from a
// path; a config validateConfig accepts and buildModel builds cleanly.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateConfig } from '../../../src/core/config/schema.ts';
import { inferModules } from '../../../src/core/layout/infer-modules.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { buildNameOf, configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { analysisOf, BASE, fact, HEADER_END, romWith } from '../layout/hand-made.ts';

const SHA1 = '0123456789abcdef0123456789abcdef01234567';

function romWithCode(code: string) {
  const bytes = new TextEncoder().encode(code);
  return romFromBytes(romWith([{ at: BASE + 0xac, bytes }], { size: 0x200 }).bytes, SHA1);
}

test('the build name is the game code lower-cased when it is four letters or digits, else rom', () => {
  assert.equal(buildNameOf(romWithCode('BPEE')), 'bpee');
  assert.equal(buildNameOf(romWithCode('AK9E')), 'ak9e');
  assert.equal(buildNameOf(romWithCode('A-B ')), 'rom');
  assert.equal(buildNameOf(romFromBytes(romWith([], { size: 0x200 }).bytes, SHA1)), 'rom');
});

test('every found entry is listed with its mode and default name; an entry inside another extent is an entry point, the startup code inside the cartridge entry included', () => {
  const rom = romWithCode('KLON');
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: BASE, end: BASE + 0xe0, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }] }),
      fact({ entry: HEADER_END, end: BASE + 0xe0, mode: 'arm' }),
      fact({ entry: BASE + 0x100, end: BASE + 0x120 }),
      fact({ entry: BASE + 0x110, end: BASE + 0x118 }),
      fact({ entry: BASE + 0x120, end: BASE + 0x130, mode: 'arm' }),
    ],
    startupEnd: BASE + 0xe0,
  });
  const config = configFromDiscover(rom, analysis);
  assert.deepEqual(
    [...config.functions.entries()].map(([a, f]) => [a - BASE, f]),
    [
      [0, { name: 'sub_08000000', mode: 'arm', aliases: [] }],
      [0x100, { name: 'sub_08000100', mode: 'thumb', aliases: [] }],
      [0x120, { name: 'sub_08000120', mode: 'arm', aliases: [] }],
    ],
  );
  assert.deepEqual(
    [...config.entryPoints.entries()].map(([a, e]) => [a - BASE, e]),
    [
      [0xc0, { name: 'sub_080000C0', mode: 'arm', aliases: [] }],
      [0x110, { name: 'sub_08000110', mode: 'thumb', aliases: [] }],
    ],
  );
  assert.deepEqual(
    config.modules.map((m) => [m.name, m.start - BASE, m.kind, m.generated]),
    [
      ['rom_header', 0, 'asm', true],
      ['crt0', 0xc0, 'asm', true],
      ['main', 0xe0, 'c', true],
      ['asm_08000120', 0x120, 'asm', true],
      ['data', 0x130, 'data', true],
    ],
  );
  assert.deepEqual(config.rom, { path: 'baserom.gba', sha1: SHA1 });
  assert.deepEqual(config.build, { name: 'klon', compiler: 'agbcc' });
  assert.deepEqual(config.signatures, { enabled: false });
  assert.equal(config.symbols.size, 0);
  assert.deepEqual(config.overrides, []);
  const valid = validateConfig(config);
  assert.ok(valid.ok, valid.ok ? '' : JSON.stringify(valid.issues));
});

test('a library region becomes an asm module carrying its library and version', () => {
  const rom = romWithCode('KLON');
  const analysis = analysisOf(rom, { functions: [0, 1, 2, 3].map((i) => fact({ entry: BASE + 0x100 + 0x10 * i, end: BASE + 0x110 + 0x10 * i })) });
  const config = configFromDiscover(rom, analysis, { libraries: [{ span: { start: BASE + 0x110, end: BASE + 0x120 }, library: 'm4a', version: '2001' }] });
  assert.deepEqual(config.modules.find((m) => m.name === 'm4a'), { name: 'm4a', start: BASE + 0x110, kind: 'asm', generated: true, library: 'm4a', version: '2001' });
});

test('on every committed fixture the config validates, lists the cartridge and startup entries, and builds without a diagnostic', () => {
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const analysis = discover(rom);
    const config = configFromDiscover(rom, analysis);
    const valid = validateConfig(config);
    assert.ok(valid.ok, `${fixture.name}: ${valid.ok ? '' : JSON.stringify(valid.issues)}`);
    assert.equal(config.functions.size + config.entryPoints.size, analysis.functions.length, fixture.name);
    for (const e of analysis.startup.entries) assert.ok(config.functions.has(e) || config.entryPoints.has(e), `${fixture.name}: startup entry 0x${e.toString(16)}`);
    assert.equal(config.modules[0]?.name, 'rom_header');
    const model = buildModel(rom, analysis, config);
    assert.deepEqual(model.diagnostics, [], fixture.name);
  }
});

test('the kind flip (D62 c): every agbcc-shaped module inferModules proposes without a library is c, every other keeps its proposed kind', () => {
  let cModules = 0;
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const analysis = discover(rom);
    const proposed = inferModules(rom, analysis, {}).flatMap((p) => (p.kind === 'module' ? [p] : []));
    const config = configFromDiscover(rom, analysis);
    assert.deepEqual(
      config.modules.map((m) => [m.name, m.kind]),
      proposed.map((p) => [p.name, p.moduleKind === 'c' && p.library === undefined ? 'c' : p.moduleKind]),
      fixture.name,
    );
    for (const m of config.modules) {
      if (m.kind !== 'c') continue;
      cModules++;
      assert.equal(m.library, undefined, `${fixture.name}: ${m.name}`);
      assert.notEqual(m.name, 'rom_header');
      assert.notEqual(m.name, 'crt0');
    }
  }
  assert.ok(cModules > 0, 'some fixture has a C module');
});
