// The disk snapshot for planWrites (architecture §6.4 step 3): every file under the generated roots plus
// the given paths, hashed, 'absent' for a missing one, in code-unit order; the manifest and journal readers.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { encodeJournal } from '../../../../src/core/write-plan/journal.ts';
import { encodeManifest } from '../../../../src/core/write-plan/manifest.ts';
import { JOURNAL_PATH, MANIFEST_PATH } from '../../../../src/core/write-plan/types.ts';
import type { Manifest } from '../../../../src/core/write-plan/types.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { readDiskState, readJournal, readManifest, readReconciledTexts } from '../../../../src/shell/project/disk-state.ts';

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
    ['asm/main.s', sha1Of('a')],
    ['asm/nonmatchings/main/B.s', sha1Of('b')],
    ['asm/nonmatchings/main/a.s', sha1Of('c')],
    ['data/main.s', sha1Of('d')],
    ['expected/main.s', sha1Of('e')],
    ['include/macros.inc', 'absent'],
    ['ldscript.txt', sha1Of('l')],
    ['src/main.c', sha1Of('c-file')],
    ['symbols.ld', sha1Of('s')],
  ]);
});

test('readDiskState of an empty directory is the given paths, absent', async () => {
  const dir = await project({});
  const state = await readDiskState(dir, ['asm/a.s', 'asm/a.s']);
  assert.ok(state.ok);
  assert.deepEqual([...state.value], [['asm/a.s', 'absent']]);
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
