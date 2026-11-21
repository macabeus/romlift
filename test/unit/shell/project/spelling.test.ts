// renameCase (shell/project/spelling.ts, architecture-r2-4): a case-only rename through a temporary name. A
// failure of the second rename moves the entry back to its old name; a failure of that too leaves it under the
// temporary name, and the result says where it is, so the diagnostic never names a path that no longer exists.
// restoreCaseRenames: an entry a crash left under the temporary name is put back under its old name when a write or
// edit path of the interrupted run's journal names it, so that the next run's op renames it again.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { Journal } from '../../../../src/core/write-plan/journal.ts';
import {
  caseRenameOrigin,
  caseTemporaryName,
  renameCase,
  restoreCaseRenames,
} from '../../../../src/shell/project/spelling.ts';
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

const SHA1 = 'a'.repeat(40);

function journalOf(...ops: Journal['ops']): Journal {
  return { schema: 1, ops };
}

test('the temporary name keeps the old name, which caseRenameOrigin reads back', () => {
  assert.equal(caseTemporaryName('main', 123), '.romlift-case-123-main');
  assert.equal(caseRenameOrigin(caseTemporaryName('Some.Module-1', 9)), 'Some.Module-1');
  assert.equal(caseRenameOrigin(caseTemporaryName('main')), 'main', 'the default pid is this process');
  for (const name of [
    'main',
    '.romlift-case-main',
    '.romlift-case--main',
    '.romlift-case-12-',
    'x.romlift-case-1-main',
  ])
    assert.equal(caseRenameOrigin(name), undefined, name);
});

/** `dir/asm/nonmatchings/<temporary name of main>/notes.txt`, as a crash between the two renames leaves it. */
async function stranded(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-spelling-'));
  roots.push(dir);
  await mkdir(join(dir, 'asm', 'nonmatchings', caseTemporaryName('main', 4242)), { recursive: true });
  await writeFile(join(dir, 'asm', 'nonmatchings', caseTemporaryName('main', 4242), 'notes.txt'), 'mine\n');
  return dir;
}

test('restoreCaseRenames puts an entry a journalled write path names back under its old name', async () => {
  const dir = await stranded();
  const journal = journalOf(
    { op: 'delete', path: 'asm/main.s' },
    { op: 'write', path: 'asm/nonmatchings/Main/sub_08000100.s', resultSha1: SHA1 },
  );
  assert.equal(await restoreCaseRenames(dir, journal), undefined);
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings')), ['main']);
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings', 'main')), ['notes.txt']);
  assert.equal(await restoreCaseRenames(dir, journal), undefined, 'a second call finds nothing to do');
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings')), ['main']);
});

test('restoreCaseRenames follows an edit path too, and a file component as well as a directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-spelling-'));
  roots.push(dir);
  await mkdir(join(dir, 'src'));
  await writeFile(join(dir, 'src', caseTemporaryName('main.c', 7)), 'int x;\n');
  assert.equal(
    await restoreCaseRenames(dir, journalOf({ op: 'edit', path: 'src/Main.c', baseSha1: SHA1, resultSha1: SHA1 })),
    undefined,
  );
  assert.deepEqual(await readdir(join(dir, 'src')), ['main.c']);
});

test('restoreCaseRenames leaves alone an entry no journalled write or edit names, and one whose old name is taken again', async () => {
  const dir = await stranded();
  const temporary = caseTemporaryName('main', 4242);
  await restoreCaseRenames(
    dir,
    journalOf(
      { op: 'delete', path: 'asm/nonmatchings/Main/sub_08000100.s' },
      { op: 'write', path: 'asm/nonmatchings/other/f.s', resultSha1: SHA1 },
    ),
  );
  assert.deepEqual(
    await readdir(join(dir, 'asm', 'nonmatchings')),
    [temporary],
    'a delete does not respell, and other/ is not main/',
  );
  await mkdir(join(dir, 'asm', 'nonmatchings', 'MAIN'));
  await restoreCaseRenames(dir, journalOf({ op: 'write', path: 'asm/nonmatchings/Main/f.s', resultSha1: SHA1 }));
  assert.deepEqual(
    (await readdir(join(dir, 'asm', 'nonmatchings'))).sort(),
    [temporary, 'MAIN'].sort(),
    'nothing is renamed onto a name that is taken',
  );
});

test('restoreCaseRenames stops at a component that does not exist or is a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-spelling-'));
  roots.push(dir);
  await writeFile(join(dir, 'asm'), 'a file where a directory is expected\n');
  const journal = journalOf(
    { op: 'write', path: 'asm/nonmatchings/Main/f.s', resultSha1: SHA1 },
    { op: 'write', path: 'data/x/y.s', resultSha1: SHA1 },
  );
  assert.equal(await restoreCaseRenames(dir, journal), undefined);
  assert.deepEqual(await readdir(dir), ['asm']);
});
