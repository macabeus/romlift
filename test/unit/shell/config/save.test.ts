// saveConfig (architecture §6.4, §6.5): the text written as given, through a temporary file and a rename, so no
// temporary file stays and an existing config is replaced whole; a config path from decomp.yaml; a path outside
// the project or a directory that cannot take the file is E_IO_WRITE, and nothing is written.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { renderDecompYaml } from '../../../../src/core/config/decomp-yaml.ts';
import { loadConfig } from '../../../../src/shell/config/load.ts';
import { saveConfig } from '../../../../src/shell/config/save.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'romlift-save-')));
  roots.push(dir);
  return dir;
}

const SHA1 = 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b';
const TEXT = `# kept\nschema = 1\n\n[rom]\npath = "baserom.gba"\nsha1 = "${SHA1}"\n\n[build]\nname = "akle"\ncompiler = "agbcc"\n\n[signatures]\nenabled = false\n\n[functions]\n0x08000000 = "Main"   # mine\n\n[symbols]\n`;

test('saveConfig writes the text as given and leaves no temporary file', async () => {
  const dir = await tempDir();
  assert.deepEqual(await saveConfig(dir, TEXT), { ok: true, value: undefined });
  assert.equal(await readFile(join(dir, 'romlift.toml'), 'utf8'), TEXT);
  assert.deepEqual(await saveConfig(dir, TEXT.replace('Main', 'AgbMain')), { ok: true, value: undefined });
  assert.equal(await readFile(join(dir, 'romlift.toml'), 'utf8'), TEXT.replace('Main', 'AgbMain'));
  assert.deepEqual(await readdir(dir), ['romlift.toml']);
});

test('a saved config loads back to the same text, at the path decomp.yaml names (always romlift.toml since fix round 7, D83 b)', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'decomp.yaml'), renderDecompYaml({ name: 'akle', title: 'KLONOA', gameCode: 'AKLE', sha1: SHA1 }));
  assert.equal((await saveConfig(dir, TEXT, 'romlift.toml')).ok, true);
  const loaded = await loadConfig(dir);
  assert.ok(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.diagnostics));
  assert.equal(loaded.value.text, TEXT);
  assert.equal(loaded.value.value.functions.get(0x0800_0000)?.name, 'Main');
});

test('a path outside the project, or a directory that cannot take the file, is E_IO_WRITE', async () => {
  const dir = await tempDir();
  for (const path of ['../romlift.toml', '/tmp/romlift.toml', 'a/../romlift.toml', '']) {
    const saved = await saveConfig(dir, TEXT, path);
    assert.deepEqual(saved.ok ? '' : [saved.diagnostic.code, saved.diagnostic.message], ['E_IO_WRITE', `cannot write ${path}: not a path inside the project`]);
  }
  const absent = await saveConfig(dir, TEXT, 'missing/romlift.toml');
  assert.equal(absent.ok ? '' : absent.diagnostic.code, 'E_IO_WRITE');
  assert.deepEqual(await readdir(dir), []);
});
