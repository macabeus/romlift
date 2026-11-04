// parseConfig (architecture §3.4, §6.5, D22): §6.5's illustrative file, comments and all, parses to its in-memory
// config; every key of schema 1 and its TOML spelling; the defaults; a hand-restructured table; and the codes,
// each with its line: E_TOML_PARSE, E_TOML_SCHEMA, and on every committed fixture's config the two illegal edits
// of g4.toml-mutations (a repeated [functions] line is E_DUPLICATE_ADDRESS, a key without its leading zero is
// E_TOML_KEY_SPELLING). A module start that is no legal border parses: that is the model's E_MODULE_BORDER.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { prngSequence } from '../../helpers/prng.ts';

/** §6.5's illustrative file, verbatim. */
const ILLUSTRATIVE = `schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "klonoa-eod"
compiler = "agbcc"            # the default build compiler of every module

[signatures]                  # read by init and update only (phase 6)
enabled = true

[[modules]]                   # link order; start addresses increase; each start is a legal border
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
data_start = 0x0804EF00       # its C data range (§6.6, phase 6)
compiler = "old_agbcc"        # per-module build compiler and extra flags (D47)
cflags = ["-O1"]

[[modules]]
name = "m4a"
start = 0x0804F000
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]                   # a runs_at range is its own module (§6.7)
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

[functions]                   # every entry is listed; keys are 0x plus eight upper-case hex digits
0x08000470 = "AgbMain"
0x080000FC = { name = "IntrMain", mode = "arm" }
0x0804F318 = { name = "SoundMainRAM", size = 0x3A4, from = "sig:m4a@2001" }
0x0804F73E = { name = "_0804F73E", label = true }               # a second entry inside its parent

[symbols]                     # data and RAM
0x03005220 = "gUnk_03005220"
0x03002920 = { name = "gEntityInfo", aliases = ["gUnk_03002920"] }
0x08189E84 = { name = "gSpriteDataTable", size = 0x40, type = "pointers" }

[[overrides]]                 # facts analysis cannot infer; each is validated
start = 0x0804F318
size = 0x400
kind = "code"
runs_at = 0x03000388
`;

/** The same, in memory (test/unit/config/schema.test.ts's EXAMPLE). */
const ILLUSTRATIVE_CONFIG: RomliftConfig = {
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
    [0x0800_00fc, { name: 'IntrMain', mode: 'arm', aliases: [] }],
    [0x0800_0470, { name: 'AgbMain', mode: 'thumb', aliases: [] }],
    [0x0804_f318, { name: 'SoundMainRAM', mode: 'thumb', size: 0x3a4, aliases: [], from: 'sig:m4a@2001' }],
    [0x0804_f73e, { name: '_0804F73E', mode: 'thumb', label: true, aliases: [] }],
  ]),
  symbols: new Map([
    [0x0300_2920, { name: 'gEntityInfo', aliases: ['gUnk_03002920'] }],
    [0x0300_5220, { name: 'gUnk_03005220', aliases: [] }],
    [0x0818_9e84, { name: 'gSpriteDataTable', size: 0x40, type: 'pointers', aliases: [] }],
  ]),
  overrides: [{ start: 0x0804_f318, size: 0x400, kind: 'code', runsAt: 0x0300_0388 }],
};

const MINIMAL = 'schema = 1\n\n[rom]\npath = "baserom.gba"\nsha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"\n\n[build]\nname = "x"\ncompiler = "agbcc"\n\n[signatures]\nenabled = false\n';

function ok(text: string): RomliftConfig {
  const parsed = parseConfig(text);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  return parsed.value;
}

function messages(text: string): string[] {
  const parsed = parseConfig(text);
  assert.equal(parsed.ok, false, 'expected a refusal');
  return parsed.diagnostics.map((d) => `${d.code} ${d.message}`);
}

/** Every committed fixture's config as configFromDiscover builds it, and its canonical text. */
function fixtureTexts(): { readonly name: string; readonly config: RomliftConfig; readonly text: string }[] {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  return listSyntheticFixtures().map((fixture) => {
    const rom = readFixtureRom(fixture);
    const config = configFromDiscover(rom, discover(rom, { profile }));
    return { name: fixture.name, config, text: serializeConfig(config) };
  });
}

test("§6.5's illustrative file parses, comments and all, to its in-memory config", () => {
  const parsed = parseConfig(ILLUSTRATIVE);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(parsed.value, ILLUSTRATIVE_CONFIG);
  assert.deepEqual([...parsed.value.functions.keys()], [0x0800_00fc, 0x0800_0470, 0x0804_f318, 0x0804_f73e], 'the maps are in address order');
});

test('every key of schema 1 reads into its in-memory member', () => {
  const config = ok(`${MINIMAL.replace('enabled = false', 'enabled = true\nlibraries = ["m4a", "libgcc"]')}
[[modules]]
name = "kept"
start = 0x08000000
kind = "c"
data_start = 0x08000F00
generated = false
compiler = "old_agbcc"
cflags = ["-O1", "-ftst"]
library = "agb"
version = "1"

[functions]
0x08000000 = { name = "F", mode = "arm", size = 0x10, label = true, aliases = ["G", "H"], from = "sig:gate@0" }

[symbols]
0x03000000 = { name = "gS", size = 0x4, type = "bytes", aliases = ["gT"], from = "sig:m4a@2001" }

[[overrides]]
start = 0x08000100
size = 0x20
kind = "data"
mode = "thumb"
runs_at = 0x03000000
from = "sig:m4a@2001"
`);
  assert.deepEqual(config.signatures, { enabled: true, libraries: ['m4a', 'libgcc'] });
  assert.deepEqual(config.modules, [{ name: 'kept', start: 0x0800_0000, kind: 'c', dataStart: 0x0800_0f00, generated: false, compiler: 'old_agbcc', cflags: ['-O1', '-ftst'], library: 'agb', version: '1' }]);
  assert.deepEqual(config.functions.get(0x0800_0000), { name: 'F', mode: 'arm', size: 0x10, label: true, aliases: ['G', 'H'], from: 'sig:gate@0' });
  assert.deepEqual(config.symbols.get(0x0300_0000), { name: 'gS', size: 4, type: 'bytes', aliases: ['gT'], from: 'sig:m4a@2001' });
  assert.deepEqual(config.overrides, [{ start: 0x0800_0100, size: 0x20, kind: 'data', mode: 'thumb', runsAt: 0x0300_0000, from: 'sig:m4a@2001' }]);
});

test('source is a module string, syntax only: its legality is the model\'s (D109)', () => {
  const module = (value: string): string => `${MINIMAL}\n[[modules]]\nname = "m"\nstart = 0x08000000\nkind = "asm"\nsource = ${value}\n`;
  assert.deepEqual(ok(module('"src/asm/m.s"')).modules, [{ name: 'm', start: 0x0800_0000, kind: 'asm', generated: true, source: 'src/asm/m.s' }]);
  assert.deepEqual(ok(module('"asm/m.s"')).modules[0]?.source, 'asm/m.s', 'a path under asm/ parses; the model refuses it');
  assert.equal(messages(module('7')).length, 1);
  assert.equal(messages(module('""')).length, 1);
});

test('data_start is a module address, syntax only, reported under its TOML spelling (phase 6, D92)', () => {
  const module = (value: string): string => `${MINIMAL}\n[[modules]]\nname = "m"\nstart = 0x08000000\nkind = "c"\ndata_start = ${value}\n`;
  assert.deepEqual(ok(module('0x08000100')).modules, [{ name: 'm', start: 0x0800_0000, kind: 'c', dataStart: 0x0800_0100, generated: true }]);
  // Below its module's start, or in an asm module: still syntax; whether the range is legal is the model's question.
  assert.equal(ok(module('0x07000000')).modules[0]?.dataStart, 0x0700_0000);
  assert.deepEqual(messages(module('"0x08000100"')), ['E_TOML_SCHEMA line 18: modules[0].data_start: Invalid input: expected number, received string']);
  assert.deepEqual(messages(module('-4')), ['E_TOML_SCHEMA line 18: modules[0].data_start: Too small: expected number to be >=0']);
  assert.match(messages(`${MINIMAL}\n[[modules]]\nname = "m"\nstart = 0x08000000\nkind = "c"\ndataStart = 0x08000100\n`)[0] ?? '', /unknown key `dataStart` \(schema 1 has name, start, kind, data_start, generated/);
});

test('defaults: a bare name is a Thumb entry with no aliases, a module is generated, absent tables are empty', () => {
  const config = ok(`${MINIMAL}\n[functions]\n0x08000000 = "F"\n0x08000010 = { name = "G" }\n\n[symbols]\n0x03000000 = "gS"\n`);
  assert.deepEqual(config.functions.get(0x0800_0000), { name: 'F', mode: 'thumb', aliases: [] });
  assert.deepEqual(config.functions.get(0x0800_0010), { name: 'G', mode: 'thumb', aliases: [] });
  assert.deepEqual(config.symbols.get(0x0300_0000), { name: 'gS', aliases: [] });
  const bare = ok(`${MINIMAL}\n[[modules]]\nname = "m"\nstart = 0x08000000\nkind = "asm"\n`);
  assert.equal(bare.modules[0]?.generated, true);
  assert.equal(bare.functions.size, 0);
  assert.equal(bare.symbols.size, 0);
  assert.deepEqual(bare.overrides, []);
});

test('a [functions.0x…] table or dotted keys restructured by hand parse to the same entry as the line', () => {
  const line = ok(`${MINIMAL}\n[functions]\n0x08000000 = { name = "F", mode = "arm", aliases = ["G"] }\n`);
  const table = ok(`${MINIMAL}\n[functions]\n\n[symbols]\n\n[functions.0x08000000]\nname = "F"\nmode = "arm"\naliases = [\n  "G",\n]\n`);
  const dotted = ok(`${MINIMAL}\n[functions]\n0x08000000.name = "F"\n0x08000000.mode = "arm"\n0x08000000.aliases = ["G"]\n`);
  assert.deepEqual(table, line);
  assert.deepEqual(dotted, line);
});

test('text that is not TOML is E_TOML_PARSE with its line and column', () => {
  assert.deepEqual(messages(`${MINIMAL}cflags = ["-O1"\n`), ['E_TOML_PARSE line 14, column 1: expected comma or end of structure']);
  assert.deepEqual(messages('schema = \n'), ['E_TOML_PARSE line 1, column 10: invalid value']);
  const duplicateKey = messages(`${MINIMAL.replace('enabled = false', 'enabled = false\nenabled = true')}`);
  assert.equal(duplicateKey.length, 1);
  assert.match(duplicateKey[0] ?? '', /^E_TOML_PARSE line 13, column \d+: /);
});

test('the build name is one init accepts, and the project\'s ROM is always baserom.gba (D75 i)', () => {
  const name = MINIMAL.match(/^name = "([^"]+)"$/m)?.[1] ?? assert.fail('MINIMAL has no [build] name');
  assert.deepEqual(messages(MINIMAL.replace(`name = "${name}"`, 'name = "../../evil name"')), [
    "E_TOML_SCHEMA line 8: build.name: not a build name (letters, digits, '.', '_' and '-', a letter or digit first, at most 100 characters)",
  ]);
  assert.deepEqual(messages(MINIMAL.replace('path = "baserom.gba"', 'path = "nonexistent.gba"')), [
    "E_TOML_SCHEMA line 4: rom.path: the project's ROM is always baserom.gba, which setup.sh, the Makefile and every .incbin name (D74 c)",
  ]);
});

test('TOML that is not schema 1 is E_TOML_SCHEMA, every issue at once, with its line', () => {
  assert.deepEqual(messages(`${MINIMAL}\n[analysis]\ndisable = ["seed.x"]\n`), [
    'E_TOML_SCHEMA line 14: analysis: unknown key `analysis` (schema 1 has schema, rom, build, signatures, modules, functions, symbols, overrides)',
  ]);
  assert.deepEqual(messages(`${MINIMAL}\n[[overrides]]\nstart = 0x08000000\nsize = 0x10\nkind = "code"\nrunsAt = 0x03000000\n`), [
    'E_TOML_SCHEMA line 18: overrides[0].runsAt: unknown key `runsAt` (schema 1 has start, size, kind, mode, runs_at, from)',
  ]);
  assert.deepEqual(messages(`${MINIMAL.replace('compiler = "agbcc"', 'compiler = "gcc"')}\n[[modules]]\nname = "m"\nstart = 0x08000000\nkind = "rom"\n[functions]\n0x08000000 = { name = "1bad" }\n`), [
    'E_UNKNOWN_COMPILER line 9: build.compiler: not a registered build compiler (core/config/compilers.ts)',
    'E_TOML_SCHEMA line 17: modules[0].kind: Invalid option: expected one of "asm"|"c"|"data"',
    'E_TOML_SCHEMA line 19: functions.0x08000000.name: not an assembler symbol name (a letter or _, then letters, digits, _, . and $, at most 200 characters)',
  ]);
  assert.deepEqual(messages(MINIMAL.replace(/\[rom\]\npath = "baserom.gba"\nsha1 = "[0-9a-f]+"\n\n/, '').replace('schema = 1', 'schema = 2')), [
    'E_TOML_SCHEMA line 1: schema: Invalid input: expected 1',
    'E_TOML_SCHEMA rom: Invalid input: expected object, received undefined',
  ]);
  assert.deepEqual(messages(`${MINIMAL}\n[functions]\n0x08000000 = 5\n0x08000010 = { name = "G", size = 0 }\n`), [
    'E_TOML_SCHEMA line 15: functions.0x08000000: must be a name string or a table',
    'E_TOML_SCHEMA line 16: functions.0x08000010.size: Too small: expected number to be >=1',
  ]);
  assert.deepEqual(messages(`modules = 3\nfunctions = []\n${MINIMAL}`), [
    'E_TOML_SCHEMA line 1: modules: must be an array of tables ([[modules]])',
    'E_TOML_SCHEMA line 2: functions: must be a table',
  ]);
  assert.deepEqual(messages(`${MINIMAL}\nmodules = 3\n`), ['E_TOML_SCHEMA line 14: signatures.modules: unknown key `modules` (schema 1 has enabled, libraries)']);
});

test('the address checks come first and are not doubled by smol-toml', () => {
  const text = `${MINIMAL}\n[functions]\n0x08000000 = "F"\n0x08000000 = "F"\n0x800010 = "G"\n`;
  assert.deepEqual(messages(text), [
    'E_DUPLICATE_ADDRESS line 16: [functions] lists 0x08000000 twice, at lines 15 and 16',
    'E_TOML_KEY_SPELLING line 17: [functions] key 0x800010 is not 0x followed by eight upper-case hex digits; write 0x00800010',
  ]);
  const both = parseConfig(`${MINIMAL}\n[functions]\n0x08000000 = "F"\n0x08000000 = "F"\nbroken = \n`);
  assert.equal(both.ok, false);
  assert.deepEqual(
    both.diagnostics.map((d) => d.code),
    ['E_DUPLICATE_ADDRESS'],
    'smol-toml stops at the first repetition, which keys.ts already reported',
  );
});

test('a [functions] key no instruction of its mode starts at is E_FUNCTION_MISALIGNED, with its line (fix round 6, architecture-b1-1)', () => {
  const text = `${MINIMAL}\n[functions]\n0x08000100 = "A"\n0x08000105 = "Odd"\n0x0800010A = { name = "Arm", mode = "arm" }\n0x08000111 = { name = "Legacy", from = "sig:gate@0" }\n0x08000114 = { name = "ArmOk", mode = "arm" }\n`;
  assert.deepEqual(messages(text), [
    "E_FUNCTION_MISALIGNED line 16: the [functions] key 0x08000105 (Odd) is not a halfword-aligned Thumb instruction address; a Thumb function's pointer value has bit 0 set, its entry is 0x08000104",
    'E_FUNCTION_MISALIGNED line 17: the [functions] key 0x0800010A (Arm) is not a word-aligned ARM instruction address',
    "E_FUNCTION_MISALIGNED line 18: the [functions] key 0x08000111 (Legacy) is not a halfword-aligned Thumb instruction address; a Thumb function's pointer value has bit 0 set, its entry is 0x08000110",
  ]);
  assert.ok(parseConfig(`${MINIMAL}\n[functions]\n0x08000100 = "A"\n0x08000114 = { name = "ArmOk", mode = "arm" }\n`).ok);
});

test("on every committed fixture's config: the illegal edits of g4.toml-mutations give their codes", () => {
  const fixtures = fixtureTexts();
  assert.ok(fixtures.length >= 47, `${fixtures.length} fixtures`);
  const FUNCTION_LINE = /^(0x)0([0-9A-F]{7})(\s*=.*)$/;
  for (const { name, text } of fixtures) {
    const lines = text.split('\n');
    const header = lines.indexOf('[functions]');
    const at = lines.findIndex((l, i) => i > header && FUNCTION_LINE.test(l));
    const line = lines[at];
    assert.ok(header >= 0 && line !== undefined, name);
    const repeated = parseConfig([...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join('\n'));
    assert.deepEqual(
      repeated.ok ? [] : repeated.diagnostics.map((d) => [d.code, d.message]),
      [['E_DUPLICATE_ADDRESS', `line ${at + 2}: [functions] lists ${line.slice(0, 10)} twice, at lines ${at + 1} and ${at + 2}`]],
      name,
    );
    const misspelt = parseConfig([...lines.slice(0, at), line.replace(FUNCTION_LINE, '$1$2$3'), ...lines.slice(at + 1)].join('\n'));
    assert.deepEqual(
      misspelt.ok ? [] : misspelt.diagnostics.map((d) => d.code),
      ['E_TOML_KEY_SPELLING'],
      name,
    );
  }
});

test('module border legality is not the parser’s: a start 2 bytes off parses (the model gives E_MODULE_BORDER)', () => {
  for (const { name, config, text } of fixtureTexts().slice(0, 5)) {
    const moved = { ...config, modules: config.modules.map((m, i) => (i === 1 ? { ...m, start: m.start + 2 } : m)) };
    const parsed = parseConfig(serializeConfig(moved));
    assert.ok(parsed.ok, name);
    assert.equal(parsed.value.modules[1]?.start, (config.modules[1]?.start ?? 0) + 2);
    assert.notEqual(serializeConfig(parsed.value), text);
  }
});

test('parseConfig never throws: seeded random edits of a canonical file', () => {
  const base = serializeConfig(ILLUSTRATIVE_CONFIG);
  const alphabet = ' \n="\'[]{}.,#0x1Aa_-';
  const random = prngSequence(0x7011_0001, 4000);
  for (let i = 0; i < 1000; i++) {
    const at = (random[i * 4] ?? 0) % base.length;
    const length = (random[i * 4 + 1] ?? 0) % 8;
    const char = alphabet[(random[i * 4 + 2] ?? 0) % alphabet.length] ?? ' ';
    const text = `${base.slice(0, at)}${char.repeat(((random[i * 4 + 3] ?? 0) % 3) + 1)}${base.slice(at + length)}`;
    const parsed = parseConfig(text);
    if (!parsed.ok) assert.ok(parsed.diagnostics.length > 0 && parsed.diagnostics.every((d) => d.severity === 'error'), text);
  }
});
