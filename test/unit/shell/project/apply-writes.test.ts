// applyWrites (architecture §6.4 step 4, D17) on temporary directories: a plan applied in full gives the
// planned tree and manifest and removes the journal; a plan with an error touches nothing; a failure
// injected at the k-th op, for every k (and at the manifest), leaves the journal, and the next run, which
// reads the journal into planWrites, converges to the same tree and manifest as an uninterrupted run.
//
// The fault is real: the path of the op that must fail is replaced by a directory (a rename onto it and an
// unlink of it both fail), and removed again before the next run, as a crash leaves the old file in place. A crash
// between the two renames of a case rename is a child process killed there (architecture-r2-4).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
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
import { applyWrites, durableOp } from '../../../../src/shell/project/apply-writes.ts';
import { readDiskState, readExecutables, readJournal, readManifest, readReconciledTexts } from '../../../../src/shell/project/disk-state.ts';
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

/** Whether `dir/a` is reachable as `dir/b` (`b` a case variant of `a`): the file system folds case there. */
async function sameDirUnderOtherCase(dir: string, a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([stat(join(dir, a)), stat(join(dir, b))]);
    return x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

const BASE_C = '#include "global.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", Old);\n';
const RENAME: TextEdit = { start: BASE_C.indexOf('Old'), end: BASE_C.indexOf('Old') + 3, text: 'New', reason: 'add-stub' };

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

test('a save between the plan and the write is E_STALE_EDIT: the edit is not written, the save is kept, the journal stays (correctness-a2-5)', async () => {
  const dir = await tempDir();
  await seed(dir);
  const plan = await planFor(dir, tree());
  assert.deepEqual(plan.diagnostics, []);
  const saved = `${BASE_C}/* USER EDIT */\n`;
  await writeFile(join(dir, 'src/main.c'), saved);
  const applied = await applyWrites(dir, plan);
  assert.equal(applied.ok, false);
  assert.deepEqual(applied.diagnostics.map((d) => [d.code, d.path]), [['E_STALE_EDIT', 'src/main.c']]);
  assert.equal(await readFile(join(dir, 'src/main.c'), 'utf8'), saved);
  assert.equal(await exists(join(dir, JOURNAL_PATH)), true, 'the journal is left for the next run');
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

test('an executable entry is written executable before its rename; a mode op restores the bits a crash or a checkout lost (architecture-4)', async () => {
  const dir = await tempDir();
  const setup: FileEntry = { ownership: 'scaffold', path: 'setup.sh', text: '#!/bin/sh\n', writer: 'scaffold', executable: true };
  const plan1 = planWrites({ entries: [setup], manifest: null, disk: new Map([['setup.sh', { kind: 'absent' }]]), reconciledTexts: new Map(), hash: sha1Of, retained: [] });
  assert.equal((await applyWrites(dir, plan1)).ok, true);
  assert.equal((await stat(join(dir, 'setup.sh'))).mode & 0o777, 0o755);
  await chmod(join(dir, 'setup.sh'), 0o644);
  const disk = await readDiskState(dir, ['setup.sh']);
  assert.ok(disk.ok);
  const plan2 = planWrites({ entries: [setup], manifest: plan1.manifest, disk: disk.value, reconciledTexts: new Map(), hash: sha1Of, retained: [], executables: await readExecutables(dir, ['setup.sh']) });
  assert.deepEqual(plan2.ops, [{ op: 'mode', path: 'setup.sh', executable: true }]);
  assert.equal((await applyWrites(dir, plan2)).ok, true);
  assert.equal((await stat(join(dir, 'setup.sh'))).mode & 0o777, 0o755);
  assert.deepEqual([...(await readExecutables(dir, ['setup.sh', 'absent.sh']))], ['setup.sh']);
});

test('durableOp: an edit and a scaffold or c-stub file are flushed before their rename, a generated file is not', () => {
  assert.equal(durableOp({ op: 'edit', path: 'src/a.c', baseSha1: 'a', resultSha1: 'b', text: '' }), true);
  assert.equal(durableOp({ op: 'write', path: 'Makefile', text: '', sha1: 'a', writer: 'scaffold' }), true);
  assert.equal(durableOp({ op: 'write', path: 'src/a.c', text: '', sha1: 'a', writer: 'c-stub' }), true);
  assert.equal(durableOp({ op: 'write', path: 'asm/a.s', text: '', sha1: 'a', writer: 'function' }), false);
  assert.equal(durableOp({ op: 'write', path: 'ldscript.txt', text: '', sha1: 'a', writer: 'ldscript' }), false);
});

test('case-only renames of a module file, a module directory and a chunk file apply on this file system and the next plan keeps everything (correctness-2)', async () => {
  const dir = await tempDir();
  const first: FileEntry[] = [
    { ownership: 'generated', path: 'asm/main.s', text: '.include "asm/nonmatchings/main/sub_08000100.s"\n', writer: 'module' },
    { ownership: 'generated', path: 'asm/nonmatchings/main/sub_08000100.s', text: 'F\n', writer: 'function' },
    { ownership: 'generated', path: 'asm/nonmatchings/main/sub_08000200.s', text: 'G\n', writer: 'function' },
    { ownership: 'generated', path: 'asm/nonmatchings/other/sub_08000300.s', text: 'H\n', writer: 'function' },
  ];
  const second: FileEntry[] = [
    { ownership: 'generated', path: 'asm/Main.s', text: '.include "asm/nonmatchings/Main/sub_08000100.s"\n', writer: 'module' },
    { ownership: 'generated', path: 'asm/nonmatchings/Main/sub_08000100.s', text: 'F\n', writer: 'function' },
    { ownership: 'generated', path: 'asm/nonmatchings/Main/sub_08000200.s', text: 'G\n', writer: 'function' },
    { ownership: 'generated', path: 'asm/nonmatchings/other/SUB_08000300.s', text: 'H\n', writer: 'function' },
  ];
  const run = async (entries: readonly FileEntry[]): Promise<WritePlan> => {
    const manifest = await readManifest(dir);
    assert.ok(manifest.ok);
    const disk = await readDiskState(dir, [...entries.map((e) => e.path), ...Object.keys(manifest.value?.files ?? {})]);
    assert.ok(disk.ok);
    const plan = planWrites({ entries, manifest: manifest.value, disk: disk.value, reconciledTexts: new Map(), hash: sha1Of, retained: [] });
    const applied = await applyWrites(dir, plan);
    assert.ok(applied.ok, applied.diagnostics.map((d) => d.message).join('; '));
    return plan;
  };
  await run(first);
  await run(second);
  // Every file of the tree is there, under the spelling the tree gives (also on a case-insensitive file system).
  for (const e of second) assert.equal(await readFile(join(dir, ...e.path.split('/')), 'utf8'), 'text' in e ? e.text : '', e.path);
  assert.deepEqual((await readdir(join(dir, 'asm'))).filter((n) => n.endsWith('.s')), ['Main.s']);
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings')), ['Main', 'other']);
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings', 'other')), ['SUB_08000300.s']);
  const manifest = await readManifest(dir);
  assert.ok(manifest.ok);
  assert.deepEqual(Object.keys(manifest.value?.files ?? {}), second.map((e) => e.path).sort());
  // The run after converges: nothing to write or delete.
  const again = await run(second);
  assert.deepEqual([...new Set(again.ops.map((o) => o.op))], ['keep']);
});

test('a case-only rename of a module directory that holds a file romlift does not own takes the directory along, and the next run warns only about that file (correctness-r1-1)', async () => {
  const dir = await tempDir();
  const tree = (module: string): FileEntry[] => [
    { ownership: 'generated', path: `asm/${module}.s`, text: `.include "asm/nonmatchings/${module}/sub_08000100.s"\n`, writer: 'module' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000100.s`, text: 'F\n', writer: 'function' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000200.s`, text: 'G\n', writer: 'function' },
  ];
  const run = async (entries: readonly FileEntry[]): Promise<WritePlan> => {
    const manifest = await readManifest(dir);
    assert.ok(manifest.ok);
    const disk = await readDiskState(dir, [...entries.map((e) => e.path), ...Object.keys(manifest.value?.files ?? {})]);
    assert.ok(disk.ok);
    const plan = planWrites({ entries, manifest: manifest.value, disk: disk.value, reconciledTexts: new Map(), hash: sha1Of, retained: [] });
    const applied = await applyWrites(dir, plan);
    assert.ok(applied.ok, applied.diagnostics.map((d) => d.message).join('; '));
    return plan;
  };
  await run(tree('main'));
  await writeFile(join(dir, 'asm', 'nonmatchings', 'main', 'notes.txt'), 'mine\n');
  const caseInsensitive = await sameDirUnderOtherCase(join(dir, 'asm', 'nonmatchings'), 'main', 'MAIN');
  await run(tree('Main'));
  for (const e of tree('Main')) assert.equal(await readFile(join(dir, ...e.path.split('/')), 'utf8'), 'text' in e ? e.text : '', e.path);
  // On a case-insensitive file system the directory itself now carries the new spelling, the user's file inside
  // it. On a case-sensitive one `main/` is another directory: it keeps the user's file, and `Main/` is made.
  const notes = caseInsensitive ? 'asm/nonmatchings/Main/notes.txt' : 'asm/nonmatchings/main/notes.txt';
  assert.deepEqual((await readdir(join(dir, 'asm', 'nonmatchings'))).sort(), caseInsensitive ? ['Main'] : ['Main', 'main']);
  assert.deepEqual(
    (await readdir(join(dir, 'asm', 'nonmatchings', 'Main'))).sort(),
    caseInsensitive ? ['notes.txt', 'sub_08000100.s', 'sub_08000200.s'] : ['sub_08000100.s', 'sub_08000200.s'],
  );
  if (!caseInsensitive) assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings', 'main')), ['notes.txt']);
  assert.equal(await readFile(join(dir, ...notes.split('/')), 'utf8'), 'mine\n');
  // The next run keeps every tree file and warns only about the file romlift does not own, where it is.
  const again = await run(tree('Main'));
  assert.deepEqual([...new Set(again.ops.map((o) => o.op))], ['keep']);
  assert.deepEqual(again.diagnostics.map((d) => [d.code, d.path]), [['W_UNOWNED_FILE', notes]]);
});

test('readDiskState lists a file once, under the spelling it is asked for, when the disk spells its directory otherwise and both are one file', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, 'asm', 'nonmatchings', 'main'), { recursive: true });
  await writeFile(join(dir, 'asm', 'nonmatchings', 'main', 'f.s'), 'F\n');
  const state = await readDiskState(dir, ['asm/nonmatchings/Main/f.s']);
  assert.ok(state.ok);
  let caseInsensitive = true;
  try {
    await stat(join(dir, 'asm', 'nonmatchings', 'Main'));
  } catch {
    caseInsensitive = false;
  }
  if (caseInsensitive) assert.deepEqual([...state.value.keys()], ['asm/nonmatchings/Main/f.s']);
  else assert.deepEqual([...state.value.entries()], [['asm/nonmatchings/Main/f.s', { kind: 'absent' }], ['asm/nonmatchings/main/f.s', { kind: 'present', sha1: sha1Of('F\n') }]]);
});

/** A module tree whose module name a later run changes by case only (architecture-r2-4). */
function moduleTree(module: string): FileEntry[] {
  return [
    { ownership: 'generated', path: `asm/${module}.s`, text: `.include "asm/nonmatchings/${module}/sub_08000100.s"\n`, writer: 'module' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000100.s`, text: 'F\n', writer: 'function' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000200.s`, text: 'G\n', writer: 'function' },
  ];
}

/** A project that `main`'s tree was written into, with the user's notes.txt in the module's directory. */
async function moduleProject(): Promise<string> {
  const dir = await tempDir();
  await run(dir, moduleTree('main'));
  await writeFile(join(dir, 'asm', 'nonmatchings', 'main', 'notes.txt'), 'mine\n');
  return dir;
}

const APPLY_WRITES_URL = new URL('../../../../src/shell/project/apply-writes.ts', import.meta.url).href;

/**
 * Applies `plan` to `dir` in a child process that is killed (SIGKILL) right after the first rename of a case rename,
 * the one onto its temporary name: a crash between renameCase's two renames. Resolves with the child's signal.
 */
async function applyAndCrashInCaseRename(dir: string, plan: WritePlan): Promise<NodeJS.Signals | null> {
  const planFile = join(await tempDir(), 'plan.json');
  await writeFile(planFile, JSON.stringify(plan));
  const code = [
    `import fsp from 'node:fs/promises';`,
    `import { readFileSync } from 'node:fs';`,
    `import { syncBuiltinESMExports } from 'node:module';`,
    `import { basename } from 'node:path';`,
    `const original = fsp.rename;`,
    `fsp.rename = async (from, to) => {`,
    `  await original(from, to);`,
    `  if (basename(String(to)).startsWith('.romlift-case-')) process.kill(process.pid, 'SIGKILL');`,
    `};`,
    `syncBuiltinESMExports();`,
    `const { applyWrites } = await import(${JSON.stringify(APPLY_WRITES_URL)});`,
    `await applyWrites(${JSON.stringify(dir)}, JSON.parse(readFileSync(${JSON.stringify(planFile)}, 'utf8')));`,
  ].join('\n');
  const child = spawn(process.execPath, ['--conditions=source', '--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => child.on('close', (c, s) => resolve([c, s])));
  assert.ok(signal !== null || exitCode === 0, stderr);
  return signal;
}

test('a crash between the two renames of a case rename is finished by the next run, and no temporary name is left (architecture-r2-4)', async (t) => {
  const reference = await moduleProject();
  await run(reference, moduleTree('Main'));
  const expected = await filesOf(reference);
  const dir = await moduleProject();
  if (!(await sameDirUnderOtherCase(join(dir, 'asm', 'nonmatchings'), 'main', 'MAIN'))) {
    t.skip('a case-sensitive file system: respell renames nothing, so there is no rename to cut');
    return;
  }
  const plan = await planFor(dir, moduleTree('Main'));
  assert.equal(await applyAndCrashInCaseRename(dir, plan), 'SIGKILL', 'the child was killed between the two renames');
  const stranded = (await readdir(join(dir, 'asm', 'nonmatchings'))).filter((n) => n.startsWith('.romlift-case-'));
  assert.equal(stranded.length, 1, 'the crash left the directory under its temporary name');
  assert.deepEqual(await readdir(join(dir, 'asm', 'nonmatchings', stranded[0] ?? '')), ['notes.txt']);
  assert.ok(ok(await readJournal(dir)) !== null, 'and the journal');
  // The next run snapshots and plans without finishing the rename itself: applyWrites does it from the journal.
  await run(dir, moduleTree('Main'));
  assert.deepEqual(await filesOf(dir), expected, 'the next run converges to the same tree and manifest as an uninterrupted run');
});

test('applyWrites refuses to apply over a journal it cannot read, and applies nothing', async () => {
  const dir = await tempDir();
  await seed(dir);
  const plan = await planFor(dir, tree());
  await writeFile(join(dir, JOURNAL_PATH), '{ "schema": 2 }\n');
  const before = await filesOf(dir);
  const applied = await applyWrites(dir, plan);
  assert.deepEqual([applied.ok, applied.applied], [false, 0]);
  assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_IO_READ']);
  assert.deepEqual(await filesOf(dir), before);
});
