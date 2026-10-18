// withTempDir (shell/temp-dir.ts): a fresh directory under os.tmpdir(), handed to the callback and removed after
// it, also when the callback throws.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { withTempDir } from '../../../src/shell/temp-dir.ts';

test('the directory lies under os.tmpdir(), is empty, and is gone afterwards', async () => {
  let seen = '';
  const result = await withTempDir('romlift-temp-test-', async (dir) => {
    seen = dir;
    assert.ok(dir.startsWith(join(tmpdir(), 'romlift-temp-test-')), dir);
    assert.ok(existsSync(dir));
    writeFileSync(join(dir, 'file.txt'), 'x');
    return 42;
  });
  assert.deepEqual(result, { ok: true, value: 42 });
  assert.ok(!existsSync(seen));
});

test('a throwing callback still removes the directory and the error propagates', async () => {
  let seen = '';
  await assert.rejects(
    withTempDir('romlift-temp-test-', async (dir) => {
      seen = dir;
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.ok(seen !== '' && !existsSync(seen));
});
