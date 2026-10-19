// renameCase (shell/project/spelling.ts, architecture-r2-4): a case-only rename through a temporary name. A
// failure of the second rename moves the entry back to its old name; a failure of that too leaves it under the
// temporary name, and the result says where it is, so the diagnostic never names a path that no longer exists.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { renameCase } from '../../../../src/shell/project/spelling.ts';
import type { RenameFn } from '../../../../src/shell/project/spelling.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function withDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-spelling-'));
  roots.push(dir);
  await mkdir(join(dir, 'main'));
  await writeFile(join(dir, 'main', 'notes.txt'), 'mine\n');
  return dir;
}

/** rename, failing the calls whose 1-based numbers are in `failing`. */
function failingAt(...failing: number[]): RenameFn {
  let call = 0;
  return async (from, to) => {
    call++;
    if (failing.includes(call)) throw Object.assign(new Error(`injected failure of rename ${call}`), { code: 'EIO' });
    await rename(from, to);
  };
}

test('a case rename that succeeds gives the directory the new spelling, its file inside', async () => {
  const dir = await withDirectory();
  assert.deepEqual(await renameCase(dir, 'main', 'Main'), { ok: true });
  assert.deepEqual(await readdir(dir), ['Main']);
  assert.deepEqual(await readdir(join(dir, 'Main')), ['notes.txt']);
});

test('a failed second rename moves the directory back to its old name, and the result names it', async () => {
  const dir = await withDirectory();
  const result = await renameCase(dir, 'main', 'Main', failingAt(2));
  assert.ok(!result.ok);
  assert.equal(result.at, join(dir, 'main'));
  assert.match(String(result.error), /injected failure of rename 2/);
  assert.deepEqual(await readdir(dir), ['main']);
  assert.deepEqual(await readdir(join(dir, 'main')), ['notes.txt']);
});

test('when the move back fails too, the result names the temporary name the directory is under', async () => {
  const dir = await withDirectory();
  const result = await renameCase(dir, 'main', 'Main', failingAt(2, 3));
  assert.ok(!result.ok);
  const [stranded] = await readdir(dir);
  assert.match(stranded ?? '', /^\.romlift-case-\d+-main$/);
  assert.equal(result.at, join(dir, stranded ?? ''));
  assert.deepEqual(await readdir(result.at), ['notes.txt']);
});

test('a failed first rename leaves the directory where it was', async () => {
  const dir = await withDirectory();
  const result = await renameCase(dir, 'main', 'Main', failingAt(1));
  assert.ok(!result.ok);
  assert.equal(result.at, join(dir, 'main'));
  assert.deepEqual(await readdir(dir), ['main']);
});
