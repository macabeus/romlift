// Golden canonical configs (architecture §6.5, D23, g4.toml-canonical): §6.5's illustrative file made canonical
// (example.toml), a file that writes every key of schema 1 once (every-key.toml), and the config configFromDiscover
// builds for a few committed fixtures (fixture-<name>.toml), the text `init` writes for them. Every
// canonical/*.toml round-trips: serializeConfig(parseConfig(text).value) === text. UPDATE_GOLDEN=1 rewrites the
// generated ones (example and fixtures); every-key.toml is written by hand.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./canonical/', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FIXTURES = ['entry-stub-table', 'mixer-tiled-hole', 'ram-copy-bios', 'swi-reset'] as const;

/** §6.5's illustrative file, comments and all. */
const ILLUSTRATIVE = `schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "klonoa-eod"
compiler = "agbcc"            # the default build compiler of every module

[signatures]                  # read by init and analyze --update only (phase 6)
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

function golden(file: string, actual: string): void {
  const path = join(DIR, file);
  if (UPDATE) writeFileSync(path, actual);
  assert.equal(actual, readFileSync(path, 'utf8'), `${file} differs; UPDATE_GOLDEN=1 rewrites it`);
}

test("example.toml is §6.5's illustrative file made canonical", () => {
  const parsed = parseConfig(ILLUSTRATIVE);
  assert.ok(parsed.ok);
  golden('example.toml', serializeConfig(parsed.value));
});

for (const name of FIXTURES) {
  test(`fixture-${name}.toml is the config init writes for ${name}`, () => {
    const profile = profileById('agbcc');
    const fixture = listSyntheticFixtures().find((f) => f.name === name);
    if (profile === undefined || fixture === undefined) throw new Error(`no ${name} fixture or agbcc profile`);
    const rom = readFixtureRom(fixture);
    golden(`fixture-${name}.toml`, serializeConfig(configFromDiscover(rom, discover(rom, { profile }))));
  });
}

test('every canonical/*.toml round-trips through parseConfig and serializeConfig', () => {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.toml'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(files, ['every-key.toml', 'example.toml', ...FIXTURES.map((n) => `fixture-${n}.toml`)]);
  for (const file of files) {
    const text = readFileSync(join(DIR, file), 'utf8');
    const parsed = parseConfig(text);
    assert.ok(parsed.ok, `${file}: ${parsed.ok ? '' : parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
    assert.equal(serializeConfig(parsed.value), text, file);
  }
});
