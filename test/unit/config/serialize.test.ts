// serializeConfig (architecture §6.5, D23): the canonical layout `init` writes. §6.5's example in memory gives the
// expected text exactly; every optional key appears only when set, in its fixed order; strings are escaped; entries
// come out in address order whatever the Map's order; and on every committed fixture's config (configFromDiscover)
// parse∘serialize is the identity on the config and serialize∘parse on the text (g4.toml-canonical).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { functionLine, serializeConfig, symbolLine, tomlString } from '../../../src/core/config/serialize.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

/** §6.5's example in memory, its Maps in the order the illustrative file lists them (not address order). */
const EXAMPLE: RomliftConfig = {
  schema: 1,
  rom: { path: 'baserom.gba', sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b' },
  build: { name: 'klonoa-eod', compiler: 'agbcc' },
  signatures: { enabled: true },
  modules: [
    { name: 'crt0', start: 0x0800_00c0, kind: 'asm', generated: true },
    { name: 'main', start: 0x0800_043c, kind: 'c', generated: true },
    { name: 'eeprom', start: 0x0804_e800, kind: 'c', dataStart: 0x0804_ef00, generated: true, compiler: 'old_agbcc', cflags: ['-O1'] },
    { name: 'm4a', start: 0x0804_f000, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'm4a_ram', start: 0x0804_f318, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'm4a_2', start: 0x0804_f718, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'data', start: 0x0805_1bd4, kind: 'data', generated: true },
  ],
  functions: new Map([
    [0x0800_0470, { name: 'AgbMain', mode: 'thumb', aliases: [] }],
    [0x0800_00fc, { name: 'IntrMain', mode: 'arm', aliases: [] }],
    [0x0804_f318, { name: 'SoundMainRAM', mode: 'thumb', size: 0x3a4, aliases: [], from: 'sig:m4a@2001' }],
    [0x0804_f73e, { name: '_0804F73E', mode: 'thumb', label: true, aliases: [] }],
  ]),
  symbols: new Map([
    [0x0300_5220, { name: 'gUnk_03005220', aliases: [] }],
    [0x0300_2920, { name: 'gEntityInfo', aliases: ['gUnk_03002920'] }],
    [0x0818_9e84, { name: 'gSpriteDataTable', size: 0x40, type: 'pointers', aliases: [] }],
  ]),
  overrides: [{ start: 0x0804_f318, size: 0x400, kind: 'code', runsAt: 0x0300_0388 }],
};

const EXAMPLE_TEXT = `schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "klonoa-eod"
compiler = "agbcc"

[signatures]
enabled = true

[[modules]]
name = "crt0"
start = 0x080000C0
kind = "asm"

[[modules]]
name = "main"
start = 0x0800043C
kind = "c"

[[modules]]
name = "eeprom"
start = 0x0804E800
kind = "c"
data_start = 0x0804EF00
compiler = "old_agbcc"
cflags = ["-O1"]

[[modules]]
name = "m4a"
start = 0x0804F000
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]
name = "m4a_ram"
start = 0x0804F318
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]
name = "m4a_2"
start = 0x0804F718
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]
name = "data"
start = 0x08051BD4
kind = "data"

[functions]
0x080000FC = { name = "IntrMain", mode = "arm" }
0x08000470 = "AgbMain"
0x0804F318 = { name = "SoundMainRAM", size = 0x3A4, from = "sig:m4a@2001" }
0x0804F73E = { name = "_0804F73E", label = true }

[symbols]
0x03002920 = { name = "gEntityInfo", aliases = ["gUnk_03002920"] }
0x03005220 = "gUnk_03005220"
0x08189E84 = { name = "gSpriteDataTable", size = 0x40, type = "pointers" }

[[overrides]]
start = 0x0804F318
size = 0x400
kind = "code"
runs_at = 0x03000388
`;

test("§6.5's example serialises to the canonical layout, entries in address order", () => {
  assert.equal(serializeConfig(EXAMPLE), EXAMPLE_TEXT);
});

test('every optional key is written only when set, in its fixed order', () => {
  assert.equal(functionLine(0x0800_0000, { name: 'F', mode: 'thumb', aliases: [] }), '0x08000000 = "F"');
  assert.equal(functionLine(0x0800_0000, { name: 'F', mode: 'thumb', label: false, aliases: [] }), '0x08000000 = "F"');
  assert.equal(
    functionLine(0x0800_0000, { from: 'sig:gate@0', aliases: ['A', 'B'], label: true, size: 0x10, mode: 'arm', name: 'F' }),
    '0x08000000 = { name = "F", mode = "arm", size = 0x10, label = true, aliases = ["A", "B"], from = "sig:gate@0" }',
  );
  assert.equal(symbolLine(0x0300_0000, { name: 'gS', aliases: [] }), '0x03000000 = "gS"');
  assert.equal(
    symbolLine(0x0300_0000, { from: 'sig:m4a@2001', aliases: ['gT'], type: 'bytes', size: 4, name: 'gS' }),
    '0x03000000 = { name = "gS", size = 0x4, type = "bytes", aliases = ["gT"], from = "sig:m4a@2001" }',
  );
  const text = serializeConfig({
    ...EXAMPLE,
    signatures: { enabled: false, libraries: ['m4a'] },
    modules: [{ name: 'kept', start: 0x0800_0000, kind: 'c', dataStart: 0x0800_0f00, generated: false, compiler: 'old_agbcc', cflags: [], library: 'agb', version: '1' }],
    functions: new Map(),
    symbols: new Map(),
    overrides: [{ start: 0x0800_0100, size: 0x20, kind: 'data' }],
  });
  assert.ok(text.includes('[signatures]\nenabled = false\nlibraries = ["m4a"]\n\n'), text);
  assert.ok(text.includes('[[modules]]\nname = "kept"\nstart = 0x08000000\nkind = "c"\ndata_start = 0x08000F00\ngenerated = false\ncompiler = "old_agbcc"\ncflags = []\nlibrary = "agb"\nversion = "1"\n\n'), text);
  assert.ok(text.endsWith('[functions]\n\n[symbols]\n\n[[overrides]]\nstart = 0x08000100\nsize = 0x20\nkind = "data"\n'), text);
});

test('strings are TOML basic strings, escaped where they must be', () => {
  assert.equal(tomlString('plain'), '"plain"');
  assert.equal(tomlString('a "q" \\ b'), '"a \\"q\\" \\\\ b"');
  assert.equal(tomlString('line\nfeed\ttab\u0001\u007f'), '"line\\nfeed\\ttab\\u0001\\u007F"');
  assert.equal(tomlString('ポケモン'), '"ポケモン"');
  const odd = '-DNAME="odd" \\ name';
  const config = { ...EXAMPLE, modules: EXAMPLE.modules.map((m, i) => (i === 0 ? { ...m, cflags: [odd] } : m)) };
  const parsed = parseConfig(serializeConfig(config));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual(parsed.value.modules[0]?.cflags, [odd]);
});

test('parse∘serialize is the identity on the config and serialize∘parse on the text, on every fixture', () => {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  const fixtures = listSyntheticFixtures();
  assert.ok(fixtures.length >= 47);
  for (const fixture of fixtures) {
    const rom = readFixtureRom(fixture);
    const config = configFromDiscover(rom, discover(rom, { profile }));
    const text = serializeConfig(config);
    const parsed = parseConfig(text);
    assert.ok(parsed.ok, `${fixture.name}: ${parsed.ok ? '' : parsed.diagnostics.map((d) => d.message).join('; ')}`);
    assert.deepEqual(parsed.value, config, fixture.name);
    assert.equal(serializeConfig(parsed.value), text, fixture.name);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${fixture.name}: one final newline`);
  }
  const parsed = parseConfig(EXAMPLE_TEXT);
  assert.ok(parsed.ok);
  assert.equal(serializeConfig(parsed.value), EXAMPLE_TEXT);
});
