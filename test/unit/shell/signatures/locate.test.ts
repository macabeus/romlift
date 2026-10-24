// shell/signatures/locate.ts (architecture §7.1, D40, roadmap 6.A): the built signature files of $ROMLIFT_SIGNATURES,
// else of <packageRoot>/signatures/ (never its specs/), validated, one per library, sorted by library; a file that
// cannot be read, is not of schema 3 or repeats a library is skipped with a warning; no directory is no file.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { locateSignatures, readSignatureFile, SIGNATURES_ENV } from '../../../../src/shell/signatures/locate.ts';

const GOLDEN = fileURLToPath(new URL('../../../../bench/dataset/synthetic/library/signatures.golden.json', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'romlift-signatures-locate-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const OTHER = { schema: 3, library: 'aaa', builtWith: '0', versions: [] };

test('the package default: <packageRoot>/signatures/*.json, sorted by library, specs/ and other files left alone', async () => {
  const root = join(TMP, 'package');
  mkdirSync(join(root, 'signatures', 'specs'), { recursive: true });
  copyFileSync(GOLDEN, join(root, 'signatures', 'libfix.json'));
  writeFileSync(join(root, 'signatures', 'zzz-aaa.json'), JSON.stringify(OTHER));
  writeFileSync(join(root, 'signatures', 'index.md'), '# not a file to read\n');
  writeFileSync(join(root, 'signatures', 'specs', 'm4a.json'), '{"library":"m4a"}');
  mkdirSync(join(root, 'signatures', 'dir.json'));
  const located = await locateSignatures({ packageRoot: root, env: {} });
  assert.equal(located.dir, join(root, 'signatures'));
  assert.deepEqual(located.files.map((f) => f.library), ['aaa', 'libfix']);
  assert.deepEqual(located.diagnostics, []);
});

test('$ROMLIFT_SIGNATURES names the directory instead; bad files and a second file of a library are skipped with a warning', async () => {
  const dir = join(TMP, 'env');
  mkdirSync(dir, { recursive: true });
  copyFileSync(GOLDEN, join(dir, 'a.json'));
  copyFileSync(GOLDEN, join(dir, 'b.json'));
  writeFileSync(join(dir, 'c.json'), '{ broken');
  writeFileSync(join(dir, 'd.json'), JSON.stringify({ ...OTHER, schema: 2 }));
  const located = await locateSignatures({ packageRoot: join(TMP, 'nowhere'), env: { [SIGNATURES_ENV]: 'env' }, cwd: TMP });
  assert.equal(located.dir, dir);
  assert.deepEqual(located.files.map((f) => f.library), ['libfix']);
  assert.deepEqual(located.diagnostics.map((d) => [d.code, d.path]), [
    ['W_SIGNATURE_FILE_SKIPPED', join(dir, 'b.json')],
    ['W_SIGNATURE_FILE_SKIPPED', join(dir, 'c.json')],
    ['W_SIGNATURE_FILE_SKIPPED', join(dir, 'd.json')],
  ]);
});

test('no directory: no file and no diagnostic (init decides what absence means)', async () => {
  const located = await locateSignatures({ packageRoot: join(TMP, 'absent'), env: {} });
  assert.deepEqual(located, { dir: join(TMP, 'absent', 'signatures'), files: [], diagnostics: [] });
});

test('readSignatureFile: a valid file, E_IO_READ, E_SIGNATURE_FILE_INVALID', async () => {
  const ok = await readSignatureFile(GOLDEN);
  assert.ok(ok.ok);
  assert.equal(ok.value.library, 'libfix');
  const missing = await readSignatureFile(join(TMP, 'missing.json'));
  assert.ok(!missing.ok && missing.diagnostic.code === 'E_IO_READ');
  const bad = join(TMP, 'bad.json');
  writeFileSync(bad, JSON.stringify({ ...OTHER, extra: 1 }));
  const invalid = await readSignatureFile(bad);
  assert.ok(!invalid.ok && invalid.diagnostic.code === 'E_SIGNATURE_FILE_INVALID');
});
