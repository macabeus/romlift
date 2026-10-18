// applyWrites (architecture §6.4 step 4, D17) on temporary directories: a plan applied in full gives the
// planned tree and manifest and removes the journal; a plan with an error touches nothing; a failure
// injected at the k-th op, for every k (and at the manifest), leaves the journal, and the next run, which
// reads the journal into planWrites, converges to the same tree and manifest as an uninterrupted run.
//
// The fault is real: the path of the op that must fail is replaced by a directory (a rename onto it and an
// unlink of it both fail), and removed again before the next run, as a crash leaves the old file in place.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import type { FileEntry, TextEdit } from '../../../../src/core/emit/tree.ts';
import { encodeJournal, journalOf } from '../../../../src/core/write-plan/journal.ts';
import { encodeManifest } from '../../../../src/core/write-plan/manifest.ts';
import { planWrites } from '../../../../src/core/write-plan/plan-writes.ts';
import { JOURNAL_PATH, MANIFEST_PATH } from '../../../../src/core/write-plan/types.ts';
import type { Manifest, WritePlan } from '../../../../src/core/write-plan/types.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { applyWrites } from '../../../../src/shell/project/apply-writes.ts';
import { readDiskState, readJournal, readManifest, readReconciledTexts } from '../../../../src/shell/project/disk-state.ts';
import { withProjectLock } from '../../../../src/shell/project/lock.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-apply-'));
  roots.push(dir);
  return dir;
}

const BASE_C = '#include "global.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", Old);\n';
const RENAME: TextEdit = { start: BASE_C.indexOf('Old'), end: BASE_C.indexOf('Old') + 3, text: 'New', reason: 'rename' };

/** The project before the run: an old manifest, a file it no longer generates, a user Makefile and C file. */
const INITIAL: Readonly<Record<string, string>> = {
  'asm/main.s': '.include "asm/nonmatchings/main/Old.s"\n',
  'asm/nonmatchings/main/Old.s': 'Old: @ old\n',
  'asm/nonmatchings/gone/Gone.s': 'Gone:\n',
  'ldscript.txt': 'SECTIONS { old }\n',
  Makefile: 'all: # mine\n',
  'src/main.c': BASE_C,
};

function initialManifest(): Manifest {
  const files: Record<string, { sha1: string; writer: 'function' | 'module' | 'ldscript' }> = {
    'asm/main.s': { sha1: sha1Of(INITIAL['asm/main.s'] ?? ''), writer: 'module' },
    'asm/nonmatchings/main/Old.s': { sha1: sha1Of(INITIAL['asm/nonmatchings/main/Old.s'] ?? ''), writer: 'function' },
    'asm/nonmatchings/gone/Gone.s': { sha1: sha1Of(INITIAL['asm/nonmatchings/gone/Gone.s'] ?? ''), writer: 'function' },
    'ldscript.txt': { sha1: sha1Of(INITIAL['ldscript.txt'] ?? ''), writer: 'ldscript' },
  };
  return { schema: 1, romlift: '0.0.0', files };
}

function tree(): readonly FileEntry[] {
  return [
    { ownership: 'generated', path: 'asm/main.s', text: '.include "asm/nonmatchings/main/New.s"\n', writer: 'module' },
    { ownership: 'generated', path: 'asm/nonmatchings/main/New.s', text: 'New: @ new\n', writer: 'function' },
    { ownership: 'generated', path: 'data/main.s', text: '.incbin "baserom.gba"\n', writer: 'data' },
    { ownership: 'generated', path: 'ldscript.txt', text: 'SECTIONS { new }\n', writer: 'ldscript' },
    { ownership: 'scaffold', path: 'Makefile', text: 'all: # template\n', writer: 'scaffold' },
    { ownership: 'scaffold', path: 'include/macros.inc', text: '@ macros\n', writer: 'scaffold' },
    { ownership: 'reconciled', path: 'src/main.c', baseSha1: sha1Of(BASE_C), edits: [RENAME] },
  ];
}

async function seed(dir: string): Promise<void> {
  for (const [path, text] of Object.entries(INITIAL)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  await mkdir(join(dir, '.romlift'), { recursive: true });
  await writeFile(join(dir, MANIFEST_PATH), [...encodeManifest(initialManifest())].join(''));
}

function ok<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

/** What a command does: snapshot the project, plan, and return the plan (under the caller's lock). */
async function planFor(dir: string, entries: readonly FileEntry[]): Promise<WritePlan> {
  const manifest = ok(await readManifest(dir));
  const journal = ok(await readJournal(dir));
  const paths = [...entries.map((e) => e.path), ...Object.keys(manifest?.files ?? {}), ...(journal?.ops ?? []).map((o) => o.path)];
  const disk = ok(await readDiskState(dir, paths));
  const reconciledTexts = ok(await readReconciledTexts(dir, entries.filter((e) => e.ownership === 'reconciled').map((e) => e.path)));
  return planWrites({ entries, manifest, journal, disk, reconciledTexts, hash: sha1Of, retained: [], romlift: '0.1.0' });
}

async function run(dir: string, entries: readonly FileEntry[] = tree()): Promise<void> {
  const outcome = await withProjectLock(dir, async () => applyWrites(dir, await planFor(dir, entries)));
  assert.ok(outcome.ok, JSON.stringify(outcome.diagnostics));
  assert.ok(outcome.value.ok, JSON.stringify(outcome.value.diagnostics));
}

/** Every file below `dir` with its text; directories are not files. */
async function filesOf(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await filesOf(dir, path));
    else out[path] = await readFile(join(dir, path), 'utf8');
  }
  return out;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function reference(): Promise<Record<string, string>> {
  const dir = await tempDir();
  await seed(dir);
  await run(dir);
  return filesOf(dir);
}

test('an uninterrupted run writes the plan, the manifest last, and removes the journal', async () => {
  const files = await reference();
  assert.equal(files['asm/main.s'], '.include "asm/nonmatchings/main/New.s"\n');
  assert.equal(files['asm/nonmatchings/main/New.s'], 'New: @ new\n');
  assert.equal(files['asm/nonmatchings/main/Old.s'], undefined);
  assert.equal(files['asm/nonmatchings/gone/Gone.s'], undefined);
  assert.equal(files['Makefile'], 'all: # mine\n', 'a scaffold file that exists is kept');
  assert.equal(files['include/macros.inc'], '@ macros\n', 'an absent scaffold file is written');
  assert.equal(files['src/main.c'], BASE_C.replace('Old', 'New'));
  assert.equal(files[JOURNAL_PATH], undefined);
  assert.equal(files['.romlift/lock'], undefined);
  const manifest = JSON.parse(files[MANIFEST_PATH] ?? '{}') as Manifest;
  assert.equal(manifest.romlift, '0.1.0');
  assert.deepEqual(Object.keys(manifest.files), ['asm/main.s', 'asm/nonmatchings/main/New.s', 'data/main.s', 'ldscript.txt']);
  assert.equal(manifest.files['data/main.s']?.sha1, sha1Of('.incbin "baserom.gba"\n'));
  assert.ok(Object.keys(files).every((path) => !path.endsWith('.tmp')), 'no temporary file is left');
});

test('a deleted file takes the directories it leaves empty with it', async () => {
  const dir = await tempDir();
  await seed(dir);
  await run(dir);
  assert.equal(await exists(join(dir, 'asm/nonmatchings/gone')), false);
  assert.equal(await exists(join(dir, 'asm/nonmatchings/main')), true);
});

test('a second run with the same tree changes nothing', async () => {
  const dir = await tempDir();
  await seed(dir);
  await run(dir);
  const before = await filesOf(dir);
  const plan = await planFor(dir, tree().map((e) => (e.ownership === 'reconciled' ? { ...e, baseSha1: sha1Of(before['src/main.c'] ?? ''), edits: [] } : e)));
  assert.deepEqual(plan.ops.filter((op) => op.op !== 'keep'), []);
  const applied = await applyWrites(dir, plan);
  assert.deepEqual([applied.ok, applied.applied], [true, 0]);
  assert.deepEqual(await filesOf(dir), before);
});

test('a plan with an error diagnostic is refused and nothing is touched', async () => {
  const dir = await tempDir();
  await seed(dir);
  await writeFile(join(dir, 'src/main.c'), `${BASE_C}// edited since\n`);
  const before = await filesOf(dir);
  const plan = await planFor(dir, tree());
  assert.ok(plan.diagnostics.some((d) => d.code === 'E_STALE_EDIT'));
  const applied = await applyWrites(dir, plan);
  assert.equal(applied.ok, false);
  assert.equal(applied.applied, 0);
  assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_STALE_EDIT']);
  assert.deepEqual(await filesOf(dir), before);
});

/** Replaces `path` by a directory, so writing or removing it fails; returns the undo. */
async function obstruct(dir: string, path: string): Promise<() => Promise<void>> {
  const file = join(dir, path);
  let saved: Buffer | undefined;
  try {
    saved = await readFile(file);
    await unlink(file);
  } catch {
    saved = undefined;
  }
  await mkdir(file, { recursive: true });
  await writeFile(join(file, 'obstacle'), 'x');
  return async () => {
    await unlink(join(file, 'obstacle'));
    await rmdir(file);
    if (saved !== undefined) await writeFile(file, saved);
  };
}

test('a failure after the k-th op, for every k, leaves the journal, and the next run converges', async () => {
  const expected = await reference();
  const probe = await tempDir();
  await seed(probe);
  const changing = journalOf((await planFor(probe, tree())).ops).ops;
  assert.ok(changing.length >= 6, `the plan has ${changing.length} changing ops`);
  for (let k = 0; k <= changing.length; k++) {
    const dir = await tempDir();
    await seed(dir);
    const plan = await planFor(dir, tree());
    const target = k < changing.length ? (changing[k]?.path ?? '') : MANIFEST_PATH;
    const undo = await obstruct(dir, target);
    const applied = await applyWrites(dir, plan);
    assert.equal(applied.ok, false, `k=${k}: the injected failure at ${target} stops the run`);
    assert.equal(applied.applied, k, `k=${k}: ${k} ops applied before it`);
    assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_IO_WRITE']);
    await undo();
    const journal = await readJournal(dir);
    assert.ok(journal.ok && journal.value !== null, `k=${k}: the journal is left`);
    if (k < changing.length) {
      assert.deepEqual(ok(await readManifest(dir)), initialManifest(), `k=${k}: the old manifest is still in place`);
    }
    await run(dir);
    assert.deepEqual(await filesOf(dir), expected, `k=${k}: the next run converges to the same tree and manifest`);
  }
});

test('a journal left after the manifest was written is finished and removed', async () => {
  const dir = await tempDir();
  await seed(dir);
  const plan = await planFor(dir, tree());
  await run(dir);
  await writeFile(join(dir, JOURNAL_PATH), [...encodeJournal(journalOf(plan.ops))].join(''));
  await run(dir);
  assert.deepEqual(await filesOf(dir), await reference());
});

test('an op path that is not a project path is refused before anything is written', async () => {
  const dir = await tempDir();
  const plan: WritePlan = {
    ops: [{ op: 'write', path: '../escape.s', text: 'x', sha1: sha1Of('x'), writer: 'function' }],
    manifest: { schema: 1, romlift: '0', files: {} },
    diagnostics: [],
  };
  const applied = await applyWrites(dir, plan);
  assert.equal(applied.ok, false);
  assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_IO_WRITE']);
  assert.deepEqual(await filesOf(dir), {});
});
