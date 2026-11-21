// readTemplates and readAgbccPin (architecture §6.3, D74 d): the package's templates/ read through shell/fs.ts and
// decoded by the pure readers; every failure is E_IO_READ with the file's path, never a throw.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ROMLIFT_RENDERED_TARGETS } from '../../../../src/core/scaffold/vars.ts';
import { readAgbccPin, readTemplates } from '../../../../src/shell/project/templates.ts';

const PACKAGE_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

async function withPackage(
  files: Readonly<Record<string, string | Uint8Array>>,
  body: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'romlift-templates-'));
  try {
    for (const [path, data] of Object.entries(files)) {
      const file = join(root, 'templates', ...path.split('/'));
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, data);
    }
    await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function manifest(extra: readonly object[]): string {
  return JSON.stringify({
    schema: 1,
    files: [...ROMLIFT_RENDERED_TARGETS.map((target) => ({ target, source: null, executable: false })), ...extra],
  });
}

test("the package's own templates read: the manifest and a text for every source it names", async () => {
  const read = await readTemplates(PACKAGE_ROOT);
  assert.ok(read.ok, read.ok ? '' : read.diagnostic.message);
  const sources = read.value.manifest.files.flatMap((f) => (f.source === null ? [] : [f.source]));
  assert.deepEqual(
    [...read.value.texts.keys()],
    [...sources].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  for (const text of read.value.texts.values()) assert.doesNotMatch(text, /\r/);
  const pin = await readAgbccPin(PACKAGE_ROOT);
  assert.ok(pin.ok);
  assert.deepEqual(pin.value, {
    url: 'https://github.com/macabeus/agbcc.git',
    commit: 'a0f70c956e8f982ee2a1f67f9fbead46cbaef339',
  });
});

test('readTemplates on a temporary package: texts keyed by source, CRLF read as LF', async () => {
  const files = {
    'MANIFEST.json': manifest([{ target: 'README.md', source: 'docs/README.md', executable: false }]),
    'docs/README.md': '# @@title@@\r\nline\r\n',
  };
  await withPackage(files, async (root) => {
    const read = await readTemplates(root);
    assert.ok(read.ok);
    assert.deepEqual([...read.value.texts.entries()], [['docs/README.md', '# @@title@@\nline\n']]);
    assert.equal(read.value.manifest.files.length, ROMLIFT_RENDERED_TARGETS.length + 1);
  });
});

test('a missing manifest, a manifest that does not decode, a missing template and non-UTF-8 text are E_IO_READ', async () => {
  await withPackage({}, async (root) => {
    const read = await readTemplates(root);
    assert.ok(!read.ok);
    assert.equal(read.diagnostic.code, 'E_IO_READ');
    assert.match(read.diagnostic.path ?? '', /MANIFEST\.json$/);
  });
  await withPackage({ 'MANIFEST.json': '{"schema":2,"files":[]}' }, async (root) => {
    const read = await readTemplates(root);
    assert.ok(!read.ok);
    assert.equal(read.diagnostic.code, 'E_IO_READ');
    assert.match(read.diagnostic.message, /MANIFEST\.json: schema 2, expected 1/);
  });
  await withPackage(
    { 'MANIFEST.json': manifest([{ target: 'Makefile', source: 'Makefile', executable: false }]) },
    async (root) => {
      const read = await readTemplates(root);
      assert.ok(!read.ok);
      assert.equal(read.diagnostic.code, 'E_IO_READ');
      assert.match(read.diagnostic.path ?? '', /templates[/\\]Makefile$/);
    },
  );
  await withPackage(
    {
      'MANIFEST.json': manifest([{ target: 'Makefile', source: 'Makefile', executable: false }]),
      Makefile: new Uint8Array([0x41, 0xff, 0x0a]),
    },
    async (root) => {
      const read = await readTemplates(root);
      assert.ok(!read.ok);
      assert.match(read.diagnostic.message, /not UTF-8 text/);
    },
  );
});

test('readAgbccPin refuses a pin that is not forty lower-case hex digits', async () => {
  await withPackage({ 'agbcc.json': '{"url":"https://github.com/pret/agbcc","commit":"DA598C1"}' }, async (root) => {
    const pin = await readAgbccPin(root);
    assert.ok(!pin.ok);
    assert.equal(pin.diagnostic.code, 'E_IO_READ');
    assert.match(pin.diagnostic.message, /agbcc\.json: commit is not forty lower-case hex digits/);
  });
});
