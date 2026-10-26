// The disk snapshot for planWrites (architecture §6.4 step 3): every file under the generated roots plus
// the given paths, hashed (`{kind: 'present', sha1}`), `{kind: 'absent'}` for a missing one, in code-unit order; the
// manifest and journal readers; the walk lists only regular files, so a FIFO is never read (gate-honesty-e1-2).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync, unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { encodeJournal } from '../../../../src/core/write-plan/journal.ts';
import { encodeManifest } from '../../../../src/core/write-plan/manifest.ts';
import { JOURNAL_PATH, MANIFEST_PATH } from '../../../../src/core/write-plan/types.ts';
import type { Manifest } from '../../../../src/core/write-plan/types.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { filesUnder, readDiskState, readJournal, readManifest, readReconciledTexts } from '../../../../src/shell/project/disk-state.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-disk-'));
  roots.push(dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

test('readDiskState hashes every file under the generated roots and the given paths', async () => {
  const dir = await project({
    'asm/main.s': 'a',
    'asm/nonmatchings/main/B.s': 'b',
    'asm/nonmatchings/main/a.s': 'c',
    'data/main.s': 'd',
    'expected/main.s': 'e',
    'ldscript.txt': 'l',
    'symbols.ld': 's',
    'src/main.c': 'c-file',
    'Makefile': 'm',
    'asmx/not-a-root.s': 'x',
    'build/main.o': 'o',
  });
  const state = await readDiskState(dir, ['src/main.c', 'include/macros.inc', 'asm/main.s']);
  assert.ok(state.ok);
  assert.deepEqual([...state.value], [
    ['asm/main.s', { kind: 'present', sha1: sha1Of('a') }],
    ['asm/nonmatchings/main/B.s', { kind: 'present', sha1: sha1Of('b') }],
    ['asm/nonmatchings/main/a.s', { kind: 'present', sha1: sha1Of('c') }],
    ['data/main.s', { kind: 'present', sha1: sha1Of('d') }],
    ['expected/main.s', { kind: 'present', sha1: sha1Of('e') }],
    ['include/macros.inc', { kind: 'absent' }],
    ['ldscript.txt', { kind: 'present', sha1: sha1Of('l') }],
    ['src/main.c', { kind: 'present', sha1: sha1Of('c-file') }],
    ['symbols.ld', { kind: 'present', sha1: sha1Of('s') }],
  ]);
});

test('readDiskState of an empty directory is the given paths, absent', async () => {
  const dir = await project({});
  const state = await readDiskState(dir, ['asm/a.s', 'asm/a.s']);
  assert.ok(state.ok);
  assert.deepEqual([...state.value], [['asm/a.s', { kind: 'absent' }]]);
});

test('readDiskState reports a directory where a file is expected, and a path that leaves the project', async () => {
  const dir = await project({ 'asm/sub/x.s': 'x' });
  const directory = await readDiskState(dir, ['asm/sub']);
  assert.ok(!directory.ok);
  assert.equal(directory.diagnostic.code, 'E_IO_READ');
  const escape = await readDiskState(dir, ['../outside']);
  assert.ok(!escape.ok);
  assert.equal(escape.diagnostic.code, 'E_IO_READ');
});

test('readManifest and readJournal: null when absent, decoded when valid, E_IO_READ when damaged', async () => {
  const dir = await project({});
  assert.deepEqual(await readManifest(dir), { ok: true, value: null });
  assert.deepEqual(await readJournal(dir), { ok: true, value: null });
  const manifest: Manifest = { schema: 1, romlift: '0.1.0', files: { 'asm/a.s': { sha1: sha1Of('a'), writer: 'function' } } };
  await mkdir(join(dir, '.romlift'));
  await writeFile(join(dir, MANIFEST_PATH), [...encodeManifest(manifest)].join(''));
  await writeFile(join(dir, JOURNAL_PATH), [...encodeJournal({ schema: 1, ops: [{ op: 'delete', path: 'asm/a.s' }] })].join(''));
  assert.deepEqual(await readManifest(dir), { ok: true, value: manifest });
  assert.deepEqual(await readJournal(dir), { ok: true, value: { schema: 1, ops: [{ op: 'delete', path: 'asm/a.s' }] } });
  await writeFile(join(dir, MANIFEST_PATH), '{"schema":2}');
  await writeFile(join(dir, JOURNAL_PATH), 'not json');
  const badManifest = await readManifest(dir);
  const badJournal = await readJournal(dir);
  assert.ok(!badManifest.ok && badManifest.diagnostic.code === 'E_IO_READ');
  assert.ok(!badJournal.ok && badJournal.diagnostic.code === 'E_IO_READ');
});

test('readReconciledTexts reads each present file', async () => {
  const dir = await project({ 'src/a.c': 'int a;\n' });
  const texts = await readReconciledTexts(dir, ['src/b.c', 'src/a.c']);
  assert.ok(texts.ok);
  assert.deepEqual([...texts.value], [['src/a.c', 'int a;\n']]);
});

/** Why the FIFO tests are skipped: mkfifo(1) is POSIX. */
const NO_FIFO = process.platform === 'win32' ? 'mkfifo is POSIX' : false;

/**
 * Makes a FIFO at `file` with mkfifo(1); returns its release, which opens it for writing without blocking and closes
 * it, so a reader blocked on it (the defect) gets end of file, then removes it in the same tick, so a later open of it
 * (a link to it) finds nothing: the test fails instead of hanging the process.
 */
function fifo(file: string): () => void {
  execFileSync('mkfifo', [file]);
  return () => {
    try {
      closeSync(openSync(file, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // ENXIO: nothing reads it, as it should be.
    }
    unlinkSync(file);
  };
}

/** `promise`, or a rejection naming `what` when it has not settled after `ms`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not return within ${ms} ms: it read a FIFO`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

test('filesUnder following links lists only regular files: a FIFO a followed link reaches, or a link to one, is left out (gate-honesty-e1-2)', { skip: NO_FIFO }, async () => {
  const dir = await project({ 'include/real/x.h': 'x' });
  const release = fifo(join(dir, 'include', 'real', 'pipe.h'));
  try {
    await symlink('real', join(dir, 'include', 'linked'));
    await symlink('real/pipe.h', join(dir, 'include', 'to-pipe.h'));
    const out: string[] = [];
    const listed = await within(filesUnder(dir, 'include', out, { followLinks: true }), 5000, 'filesUnder');
    assert.ok(listed.ok);
    assert.deepEqual(out, ['include/linked/x.h', 'include/real/x.h']);
  } finally {
    release();
  }
});

test('readDiskState returns promptly over a FIFO under a generated root: neither it nor a link to it is listed; a dangling link still reads as absent (gate-honesty-e1-2)', { skip: NO_FIFO }, async () => {
  const dir = await project({ 'asm/a.s': 'a' });
  const release = fifo(join(dir, 'asm', 'pipe.s'));
  try {
    await symlink('pipe.s', join(dir, 'asm', 'to-pipe.s'));
    await symlink('missing.s', join(dir, 'asm', 'dangling.s'));
    const state = await within(readDiskState(dir, []), 5000, 'readDiskState');
    assert.ok(state.ok);
    assert.deepEqual([...state.value], [
      ['asm/a.s', { kind: 'present', sha1: sha1Of('a') }],
      ['asm/dangling.s', { kind: 'absent' }],
    ]);
  } finally {
    release();
  }
});

// Phase 6 (gate-honesty-e1-1, roadmap "Carried from phase 4"): a followed walk enters no link to the project directory,
// to a directory it is already inside or to a directory above the project; readHeaderTexts reads behind those only the
// files an #include names. A link to a directory beside the project, or outside it, is walked.
test('filesUnder following links enters no link to the project directory, to a directory it is inside or above the project', async () => {
  const outer = await project({ 'other/x.h': 'x', 'proj/include/real/r.h': 'r', 'beside/b.h': 'b' });
  const dir = join(outer, 'proj');
  await symlink('.', join(dir, 'include', 'self'));
  await symlink('..', join(dir, 'include', 'real', 'parent'));
  await symlink(join('..', '..'), join(dir, 'include', 'up'));
  await symlink('/', join(dir, 'include', 'root'));
  await symlink(join('..', '..', 'beside'), join(dir, 'include', 'beside'));
  await symlink('..', join(dir, 'include', 'project'));
  const out: string[] = [];
  const listed = await filesUnder(dir, 'include', out, { followLinks: true });
  assert.ok(listed.ok);
  assert.deepEqual(out, ['include/beside/b.h', 'include/real/r.h']);
});
