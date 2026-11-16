// loadConfig (architecture §6.5): a project's decomp.yaml, the romlift.toml it names and that text parsed, with
// the text itself; another config path named by decomp.yaml; and each refusal as a diagnostic carrying the file it
// is about: E_PROJECT_NOT_FOUND, E_IO_READ (a missing config, a file that is not UTF-8), E_DECOMP_YAML_INVALID and
// the parser's codes (E_DUPLICATE_ADDRESS at its line).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { renderDecompYaml } from '../../../../src/core/config/decomp-yaml.ts';
import { parseConfig } from '../../../../src/core/config/parse.ts';
import type { RomliftConfig } from '../../../../src/core/config/schema.ts';
import { serializeConfig } from '../../../../src/core/config/serialize.ts';
import { loadConfig } from '../../../../src/shell/config/load.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const SHA1 = 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b';

const CONFIG: RomliftConfig = {
  schema: 1,
  rom: { path: 'baserom.gba', sha1: SHA1 },
  build: { name: 'akle', compiler: 'agbcc' },
  signatures: { enabled: false },
  modules: [{ name: 'main', start: 0x0800_0000, kind: 'asm', generated: true }],
  functions: new Map([[0x0800_0000, { name: 'sub_08000000', mode: 'arm', aliases: [] }]]),
  entryPoints: new Map(),
  symbols: new Map(),
  overrides: [],
};

async function project(files: Readonly<Record<string, string | Uint8Array>>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'romlift-load-')));
  roots.push(dir);
  for (const [path, data] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), data);
  }
  return dir;
}

const YAML = renderDecompYaml({ name: 'akle', title: 'KLONOA', gameCode: 'AKLE', sha1: SHA1 });
const TOML = `# my notes\n${serializeConfig(CONFIG)}`;

test('loadConfig reads decomp.yaml, then the romlift.toml it names, and returns the text with the value', async () => {
  const dir = await project({ 'decomp.yaml': YAML, 'romlift.toml': TOML });
  const loaded = await loadConfig(dir);
  assert.ok(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.diagnostics));
  assert.equal(loaded.value.dir, dir);
  assert.equal(loaded.value.decompYaml, join(dir, 'decomp.yaml'));
  assert.equal(loaded.value.configPath, join(dir, 'romlift.toml'));
  assert.equal(loaded.value.text, TOML);
  assert.equal(loaded.value.sha1, createHash('sha1').update(TOML).digest('hex'), 'the SHA-1 of the bytes read, for modules.mk (architecture-b2-2)');
  assert.deepEqual(loaded.value.value, CONFIG);
  assert.deepEqual(loaded.value.project, { config: 'romlift.toml', version: 'us', target: 'baserom.gba', sha1: SHA1, buildName: 'akle' });
  assert.deepEqual(loaded.value.diagnostics, []);
});

test('decomp.yaml naming another config path is refused before the file is read (fix round 7, architecture-b2-1); a relative project directory is resolved', async () => {
  const yaml = YAML.replace('config: "romlift.toml"', 'config: "config/project.toml"');
  const other = await loadConfig(await project({ 'decomp.yaml': yaml, 'config/project.toml': TOML }));
  assert.deepEqual(other.ok ? [] : other.diagnostics.map((d) => [d.code, d.path]), [['E_DECOMP_YAML_INVALID', 'decomp.yaml']]);
  const dir = await project({ 'decomp.yaml': YAML, 'romlift.toml': TOML });
  const cwd = process.cwd();
  process.chdir(dirname(dir));
  try {
    const relative = await loadConfig(dir.slice(dirname(dir).length + 1));
    assert.ok(relative.ok);
    assert.equal(relative.value.dir, dir);
    assert.equal(relative.value.configPath, join(dir, 'romlift.toml'));
  } finally {
    process.chdir(cwd);
  }
});

test('the refusals carry the file they are about', async () => {
  const empty = await project({});
  const none = await loadConfig(empty);
  assert.deepEqual(none.ok ? [] : none.diagnostics.map((d) => [d.code, d.path]), [['E_PROJECT_NOT_FOUND', empty]]);

  const missing = await loadConfig(await project({ 'decomp.yaml': YAML }));
  assert.deepEqual(missing.ok ? [] : missing.diagnostics.map((d) => [d.code, d.path]), [['E_IO_READ', 'romlift.toml']]);

  const badYaml = await loadConfig(await project({ 'decomp.yaml': YAML.replace('  romlift:\n    config: "romlift.toml"\n', ''), 'romlift.toml': TOML }));
  assert.deepEqual(badYaml.ok ? [] : badYaml.diagnostics.map((d) => [d.code, d.path]), [['E_DECOMP_YAML_INVALID', 'decomp.yaml']]);

  const ymlOnly = await loadConfig(await project({ 'decomp.yml': 'name: x\n' }));
  assert.deepEqual(ymlOnly.ok ? [] : [...new Set(ymlOnly.diagnostics.map((d) => `${d.code} ${d.path ?? ''}`))], ['E_DECOMP_YAML_INVALID decomp.yml']);

  const duplicate = TOML.replace('0x08000000 = { name = "sub_08000000", mode = "arm" }', '0x08000000 = { name = "sub_08000000", mode = "arm" }\n0x08000000 = "again"');
  const dup = await loadConfig(await project({ 'decomp.yaml': YAML, 'romlift.toml': duplicate }));
  assert.equal(dup.ok, false);
  const lines = duplicate.split('\n');
  const second = lines.indexOf('0x08000000 = "again"') + 1;
  assert.deepEqual(dup.ok ? [] : dup.diagnostics.map((d) => [d.code, d.path, d.message]), [
    ['E_DUPLICATE_ADDRESS', 'romlift.toml', `line ${second}: [functions] lists 0x08000000 twice, at lines ${second - 1} and ${second}`],
  ]);

  const binary = await loadConfig(await project({ 'decomp.yaml': YAML, 'romlift.toml': new Uint8Array([0x73, 0x63, 0xff, 0xfe]) }));
  assert.deepEqual(binary.ok ? [] : binary.diagnostics.map((d) => [d.code, d.path, d.message]), [['E_IO_READ', 'romlift.toml', 'cannot read romlift.toml: it is not UTF-8 text']]);
});

test('what loadConfig returns is what parseConfig gives for the same text', async () => {
  const dir = await project({ 'decomp.yaml': YAML, 'romlift.toml': TOML });
  const loaded = await loadConfig(dir);
  const parsed = parseConfig(TOML);
  assert.ok(loaded.ok && parsed.ok);
  assert.deepEqual(loaded.value.value, parsed.value);
});
