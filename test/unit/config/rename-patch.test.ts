// planRenamePatch (architecture §6.5, §6.6, D9, D92): one line of romlift.toml changes, the entry named (or aliased)
// `from` gets `to`, its `from` key is dropped, its indentation and trailing comment and every other byte stay; an entry
// one line cannot hold, a name of no entry and a name of two entries are refused with E_TOML_PATCH_REFUSED.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { entriesNamed, planRenamePatch } from '../../../src/core/config/rename-patch.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';

const HEAD = `schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "x"
compiler = "agbcc"

[signatures]
enabled = false

[[modules]]
name = "main"
start = 0x08000000
kind = "c"
`;

const TEXT = `${HEAD}
# the functions, by hand
[functions]
0x08000100 = "sub_08000100" # first
  0x08000200 = { name = "m4aSoundMain", size = 0x40, from = "sig:m4a@2001" }
0x08000300 = { name = "Third", aliases = ["ThirdAlias", "Other"] }

[symbols]
0x03000000 = { name = "gMain", size = 0x10, from = "sig:m4a@2001" } # RAM
`;

function parsed(text: string): RomliftConfig {
  const result = parseConfig(text);
  assert.ok(result.ok, result.ok ? '' : result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  return result.value;
}

/** The lines that differ between two texts of equally many lines. */
function changed(before: string, after: string): readonly string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  assert.equal(b.length, a.length, 'the line count changed');
  return b.filter((line, i) => line !== a[i]);
}

function patched(text: string, from: string, to: string): string {
  const result = planRenamePatch(text, parsed(text), from, to);
  assert.ok(result.ok, result.ok ? '' : result.diagnostics.map((d) => d.message).join('\n'));
  return result.text;
}

function refusal(text: string, from: string, to: string): readonly string[] {
  const result = planRenamePatch(text, parsed(text), from, to);
  assert.equal(result.ok, false, 'expected a refusal');
  return result.ok ? [] : result.diagnostics.map((d) => `${d.code} ${d.message}`);
}

test('a plain entry: one line changes, its trailing comment and every other byte stay', () => {
  const after = patched(TEXT, 'sub_08000100', 'InitGame');
  assert.deepEqual(changed(TEXT, after), ['0x08000100 = "InitGame" # first']);
  assert.equal(parsed(after).functions.get(0x08000100)?.name, 'InitGame');
});

test("the entry's from key is dropped, its indentation and other keys kept", () => {
  const after = patched(TEXT, 'm4aSoundMain', 'SoundMain');
  assert.deepEqual(changed(TEXT, after), ['  0x08000200 = { name = "SoundMain", size = 0x40 }']);
  assert.equal(parsed(after).functions.get(0x08000200)?.from, undefined);
  const symbol = patched(TEXT, 'gMain', 'gMainState');
  assert.deepEqual(changed(TEXT, symbol), ['0x03000000 = { name = "gMainState", size = 0x10 } # RAM']);
});

test('an alias is renamed in place, the name and the other aliases kept', () => {
  const after = patched(TEXT, 'ThirdAlias', 'Renamed');
  assert.deepEqual(changed(TEXT, after), ['0x08000300 = { name = "Third", aliases = ["Renamed", "Other"] }']);
  assert.deepEqual(entriesNamed(parsed(TEXT), 'Other'), [{ table: 'functions', addr: 0x08000300, role: 'alias' }]);
});

test('CRLF: the line keeps its terminator', () => {
  const crlf = TEXT.split('\n').join('\r\n');
  const after = patched(crlf, 'sub_08000100', 'InitGame');
  assert.ok(after.includes('0x08000100 = "InitGame" # first\r\n'));
  assert.equal(after.replace('InitGame', 'sub_08000100'), crlf);
});

test('refusals: no entry, two entries, a restructured table, a multi-line value', () => {
  assert.match(refusal(TEXT, 'NoSuchName', 'X')[0] ?? '', /^E_TOML_PATCH_REFUSED no \[functions\], \[entry_points\] or \[symbols\] entry/);
  const twice = TEXT.replace('aliases = ["ThirdAlias", "Other"]', 'aliases = ["ThirdAlias", "gMain"]');
  assert.match(refusal(twice, 'gMain', 'X')[0] ?? '', /names more than one entry .*\[functions\] 0x08000300, \[symbols\] 0x03000000/);
  const table = TEXT.replace('0x08000300 = { name = "Third", aliases = ["ThirdAlias", "Other"] }\n', '').replace('[symbols]', '[functions.0x08000300]\nname = "Third"\n\n[symbols]');
  const restructured = refusal(table, 'Third', 'Renamed');
  assert.match(restructured[0] ?? '', /0x08000300 in \[functions\] is not one single-line entry .* replace it with this line under \[functions\]: 0x08000300 = "Renamed"$/);
  const multi = TEXT.replace('{ name = "Third", aliases = ["ThirdAlias", "Other"] }', '{ name = "Third", aliases = [\n  "ThirdAlias",\n  "Other",\n] }');
  assert.match(refusal(multi, 'Third', 'Renamed')[0] ?? '', /is not one single-line entry/);
});

test('a config that is not what the text says is refused by the re-parse', () => {
  const config = parsed(TEXT);
  const other = { ...config, functions: new Map([...config.functions, [0x08000400, { name: 'Ghost', mode: 'thumb' as const, aliases: [] }]]) };
  const result = planRenamePatch(TEXT, other, 'Ghost', 'Real');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : (result.diagnostics[0]?.message ?? ''), /not one single-line entry|does not mean the intended config/);
  const lied = planRenamePatch(TEXT, { ...config, functions: new Map([...config.functions, [0x08000100, { name: 'sub_08000100', mode: 'arm' as const, aliases: [] }]]) }, 'sub_08000100', 'X');
  assert.equal(lied.ok, false);
  assert.match(lied.ok ? '' : (lied.diagnostics[0]?.message ?? ''), /is not what romlift.toml says/);
});
