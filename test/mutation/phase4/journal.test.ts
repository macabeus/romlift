// Fault injection into the journal and its recovery (g4.checks-fail, architecture §6.4 step 4, §10, D17): a real
// project directory planned and applied as a command does it (the lock, the manifest and the journal, the case
// renames an interrupted run left, the disk snapshot, planWrites, applyWrites). For every k, a failure injected after
// the k-th op of applyWrites (and at the manifest) leaves the journal, and the next run converges to the same tree and
// manifest as an uninterrupted run; after such a failure, an `edit` whose file changed is E_STALE_EDIT (an error: a
// command exits `errors`, 1) and nothing is applied; an edit the journal shows at its result sha1 counts as done.
// Each fault is a source mutant (mutant.ts) that the tests below are shown to catch: a recovery that ignores the
// journal (readJournal reads none, or planWrites drops it), a journal never written, a stale edit applied, an edit
// the journal shows done applied again, and a case rename cut between its two renames left unfinished
// (architecture-r2-4: the journal's paths and the temporary name, `.romlift-case-<pid>-<old name>`, say how to finish
// it, so the journal needs no new field).
//
// The failure is real: the path of the op that must fail is replaced by a directory (a rename onto it and an unlink
// of it both fail), and removed again before the next run, as a crash leaves the old file in place.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import type { FileEntry, TextEdit } from '../../../src/core/emit/tree.ts';
import { encodeJournal, journalOf } from '../../../src/core/write-plan/journal.ts';
import { encodeManifest } from '../../../src/core/write-plan/manifest.ts';
import { planWrites } from '../../../src/core/write-plan/plan-writes.ts';
import { JOURNAL_PATH, MANIFEST_PATH } from '../../../src/core/write-plan/types.ts';
import type { Manifest, WritePlan } from '../../../src/core/write-plan/types.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { applyWrites } from '../../../src/shell/project/apply-writes.ts';
import type { ApplyResult } from '../../../src/shell/project/apply-writes.ts';
import { readDiskState, readJournal, readManifest, readReconciledTexts } from '../../../src/shell/project/disk-state.ts';
import { withProjectLock } from '../../../src/shell/project/lock.ts';
import { caseTemporaryName, restoreCaseRenames } from '../../../src/shell/project/spelling.ts';
import { assertCaught, runUnderMutant, underMutation } from './mutant.ts';
import type { Mutant } from './mutant.ts';

const THIS_FILE = 'test/mutation/phase4/journal.test.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const BASE_C = '#include "global.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", Old);\n';
const RENAME: TextEdit = { start: BASE_C.indexOf('Old'), end: BASE_C.indexOf('Old') + 3, text: 'New', reason: 'rename' };
const EDITED_C = BASE_C.replace('Old', 'New');
/** A generated file outside the generated roots that the old manifest does not list: only the journal makes it romlift's. */
const OUTSIDE = 'tools/generated.s';

/** The project before the run: an old manifest, files it no longer generates, a user Makefile and C file. */
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
    { ownership: 'generated', path: OUTSIDE, text: '@ generated\n', writer: 'objdiff' },
    { ownership: 'scaffold', path: 'Makefile', text: 'all: # template\n', writer: 'scaffold' },
    { ownership: 'scaffold', path: 'include/macros.inc', text: '@ macros\n', writer: 'scaffold' },
    { ownership: 'reconciled', path: 'src/main.c', baseSha1: sha1Of(BASE_C), edits: [RENAME] },
  ];
}

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-mut-journal-'));
  roots.push(dir);
  for (const [path, text] of Object.entries(INITIAL)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  await mkdir(join(dir, '.romlift'), { recursive: true });
  await writeFile(join(dir, MANIFEST_PATH), [...encodeManifest(initialManifest())].join(''));
  return dir;
}

function ok<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.value;
}

/** What a command does before it applies: finish half-done case renames, snapshot the project and plan. */
async function planFor(dir: string, entries: readonly FileEntry[] = tree()): Promise<WritePlan> {
  const manifest = ok(await readManifest(dir));
  const journal = ok(await readJournal(dir));
  if (journal !== null) assert.equal(await restoreCaseRenames(dir, journal), undefined);
  const paths = [...entries.map((e) => e.path), ...Object.keys(manifest?.files ?? {}), ...(journal?.ops ?? []).map((o) => o.path)];
  const disk = ok(await readDiskState(dir, paths));
  const reconciledTexts = ok(await readReconciledTexts(dir, entries.filter((e) => e.ownership === 'reconciled').map((e) => e.path)));
  return planWrites({ entries, manifest, journal, disk, reconciledTexts, hash: sha1Of, retained: [], romlift: '0.1.0' });
}

/** One command run under the project lock: the plan and what applying it did. */
async function command(dir: string, entries: readonly FileEntry[] = tree()): Promise<{ readonly plan: WritePlan; readonly applied: ApplyResult }> {
  const outcome = await withProjectLock(dir, async () => {
    const plan = await planFor(dir, entries);
    return { plan, applied: await applyWrites(dir, plan) };
  });
  assert.ok(outcome.ok, JSON.stringify(outcome.diagnostics));
  return outcome.value;
}

async function run(dir: string, entries: readonly FileEntry[] = tree()): Promise<void> {
  const { applied } = await command(dir, entries);
  assert.ok(applied.ok, JSON.stringify(applied.diagnostics.map((d) => [d.code, d.message])));
}

/** Every file below `dir` with its text, in code-unit order. */
async function filesOf(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await filesOf(dir, path));
    else out[path] = await readFile(join(dir, path), 'utf8');
  }
  return out;
}

/** The tree and manifest of an uninterrupted run. */
async function reference(): Promise<Record<string, string>> {
  const dir = await project();
  await run(dir);
  return filesOf(dir);
}

/** Replaces `path` by a directory, so writing or removing it fails; returns the undo, which puts the file back. */
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

/** The ops of the plan that change a file, in the order applyWrites applies them. */
async function changingOps(): Promise<readonly { readonly op: string; readonly path: string }[]> {
  return journalOf((await planFor(await project())).ops).ops;
}

/** Applies the plan with a failure injected after its k-th changing op (k = the count: at the manifest); the journal stays. */
async function interrupt(dir: string, k: number): Promise<void> {
  const changing = await changingOps();
  const plan = await planFor(dir);
  const target = k < changing.length ? (changing[k]?.path ?? '') : MANIFEST_PATH;
  const undo = await obstruct(dir, target);
  const applied = await applyWrites(dir, plan);
  await undo();
  assert.equal(applied.ok, false, `k=${k}: the injected failure at ${target} stops the run`);
  assert.equal(applied.applied, k, `k=${k}: ${k} ops applied before it`);
  assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_IO_WRITE']);
  const journal = ok(await readJournal(dir));
  assert.ok(journal !== null, `k=${k}: the journal is left for the next run`);
  assert.deepEqual(journal, journalOf(plan.ops), `k=${k}: the journal lists every changing op of the plan`);
}

const CONVERGES = 'a failure after the k-th op, for every k, converges on the next run to the same tree and manifest';
const STALE_EDIT = 'after a failure, an edit whose file changed is E_STALE_EDIT, an error, and nothing is applied';
const EDIT_DONE = 'after a failure, an edit the journal shows at its result sha1 counts as done';
const CASE_RENAME = 'a crash between the two renames of a case rename is finished by the next run (architecture-r2-4)';

test(CONVERGES, async () => {
  const expected = await reference();
  assert.equal(expected[JOURNAL_PATH], undefined);
  assert.equal(expected['src/main.c'], EDITED_C);
  assert.equal(expected[OUTSIDE], '@ generated\n');
  const changing = await changingOps();
  assert.deepEqual(
    changing.map((o) => `${o.op} ${o.path}`),
    [
      'write asm/main.s',
      'delete asm/nonmatchings/gone/Gone.s',
      'write asm/nonmatchings/main/New.s',
      'delete asm/nonmatchings/main/Old.s',
      'write data/main.s',
      'write include/macros.inc',
      'write ldscript.txt',
      'edit src/main.c',
      `write ${OUTSIDE}`,
    ],
    'the plan holds a write, a delete, a scaffold write, an edit and an owned write outside the roots',
  );
  for (let k = 0; k <= changing.length; k++) {
    const dir = await project();
    await interrupt(dir, k);
    if (k < changing.length) assert.deepEqual(ok(await readManifest(dir)), initialManifest(), `k=${k}: the old manifest is still in place`);
    await run(dir);
    assert.deepEqual(await filesOf(dir), expected, `k=${k}: the next run converges to the same tree and manifest`);
  }
});

test(STALE_EDIT, async () => {
  for (const k of [0, 8]) {
    const dir = await project();
    await interrupt(dir, k);
    await writeFile(join(dir, 'src/main.c'), `${k === 0 ? BASE_C : EDITED_C}int added_by_hand;\n`);
    const before = await filesOf(dir);
    const { plan, applied } = await command(dir);
    assert.deepEqual(plan.diagnostics.map((d) => [d.code, d.severity, d.path]), [['E_STALE_EDIT', 'error', 'src/main.c']], `k=${k}`);
    assert.equal(applied.ok, false);
    assert.equal(applied.applied, 0);
    assert.deepEqual(applied.diagnostics.map((d) => d.code), ['E_STALE_EDIT']);
    assert.equal(applied.diagnostics.some((d) => d.severity === 'error') ? ExitCode.errors : ExitCode.ok, ExitCode.errors);
    assert.deepEqual(await filesOf(dir), before, `k=${k}: the refused plan touched nothing, the journal included`);
  }
});

test(EDIT_DONE, async () => {
  const dir = await project();
  await interrupt(dir, 8);
  assert.equal(await readFile(join(dir, 'src/main.c'), 'utf8'), EDITED_C, 'the edit was applied before the failure');
  const { plan, applied } = await command(dir);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(plan.ops.find((o) => o.path === 'src/main.c'), { op: 'keep', path: 'src/main.c', sha1: sha1Of(EDITED_C) });
  assert.ok(applied.ok);
  assert.equal(await readFile(join(dir, 'src/main.c'), 'utf8'), EDITED_C);
  assert.deepEqual(await filesOf(dir), await reference());
});

/** A module whose name the second tree changes by case only, with a file of the user's in its directory. */
function moduleTree(module: string): readonly FileEntry[] {
  return [
    { ownership: 'generated', path: `asm/${module}.s`, text: `.include "asm/nonmatchings/${module}/sub_08000100.s"\n`, writer: 'module' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000100.s`, text: 'F\n', writer: 'function' },
    { ownership: 'generated', path: `asm/nonmatchings/${module}/sub_08000200.s`, text: 'G\n', writer: 'function' },
  ];
}

/** `main` renamed `Main` by an uninterrupted run, the user's notes.txt inside the module's directory. */
async function caseProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-mut-journal-case-'));
  roots.push(dir);
  await run(dir, moduleTree('main'));
  await writeFile(join(dir, 'asm/nonmatchings/main/notes.txt'), 'mine\n');
  return dir;
}

test(CASE_RENAME, async () => {
  const uninterrupted = await caseProject();
  await run(uninterrupted, moduleTree('Main'));
  const expected = await filesOf(uninterrupted);
  // The state a crash between renameCase's two renames leaves: the journal of the run, its ops before the one that
  // renames `main` applied, and `main` under its temporary name. The ops before it are applied as a plan of their
  // own, under the old manifest; the journal is the interrupted plan's.
  const dir = await caseProject();
  const plan = await planFor(dir, moduleTree('Main'));
  const cut = plan.ops.findIndex((o) => o.op === 'write' && o.path.startsWith('asm/nonmatchings/Main/'));
  assert.ok(cut > 0, 'the case-renamed deletes come before the first write under the new spelling');
  const before = await applyWrites(dir, { ops: plan.ops.slice(0, cut), manifest: ok(await readManifest(dir)) ?? initialManifest(), diagnostics: [] });
  assert.ok(before.ok);
  await writeFile(join(dir, JOURNAL_PATH), [...encodeJournal(journalOf(plan.ops))].join(''));
  const stranded = caseTemporaryName('main', 4_194_303);
  await rename(join(dir, 'asm/nonmatchings/main'), join(dir, 'asm/nonmatchings', stranded));
  await run(dir, moduleTree('Main'));
  const files = await filesOf(dir);
  assert.deepEqual(Object.keys(files).filter((p) => p.includes('.romlift-case-')), [], 'no entry is left under a temporary name');
  assert.deepEqual(files, expected, 'the next run converges to the same tree and manifest as the uninterrupted one');
});

const MUTANTS: readonly Mutant[] = [
  {
    name: 'the recovery ignores the journal: readJournal reads none',
    mutations: [
      {
        file: 'src/shell/project/disk-state.ts',
        from: 'export async function readJournal(dir: string): Promise<IoResult<Journal | null>> {',
        to: 'export async function readJournal(dir: string): Promise<IoResult<Journal | null>> {\n  return { ok: true, value: null };',
      },
    ],
    caughtBy: [CONVERGES, EDIT_DONE],
  },
  {
    name: 'the recovery ignores the journal: planWrites drops it',
    mutations: [{ file: 'src/core/write-plan/plan-writes.ts', from: 'this.journal = journalByPath(inputs.journal);', to: 'this.journal = journalByPath(null);' }],
    caughtBy: [CONVERGES, EDIT_DONE],
  },
  {
    name: 'applyWrites never writes the journal',
    mutations: [
      {
        file: 'src/shell/project/apply-writes.ts',
        from: 'const journal = await writeText(onDisk(dir, JOURNAL_PATH), encodeJournal(journalOf(plan.ops)), true, known);',
        to: 'const journal = undefined as Diagnostic | undefined;',
      },
    ],
    caughtBy: [CONVERGES, EDIT_DONE],
  },
  {
    name: 'a stale edit is applied',
    mutations: [
      {
        file: 'src/core/write-plan/plan-writes.ts',
        from: 'if (now === op.baseSha1) return undefined;',
        to: "if (now !== '') return undefined;",
      },
    ],
    caughtBy: [STALE_EDIT],
  },
  {
    name: 'an edit the journal shows done is applied again',
    mutations: [
      {
        file: 'src/core/write-plan/plan-writes.ts',
        from: "if (done?.op === 'edit' && done.baseSha1 === baseSha1 && done.resultSha1 === disk) {",
        to: 'if (false) {',
      },
    ],
    caughtBy: [CONVERGES, EDIT_DONE],
  },
  {
    name: 'the case renames an interrupted run left half done are not finished',
    mutations: [
      {
        file: 'src/shell/project/spelling.ts',
        from: 'export async function restoreCaseRenames(dir: string, journal: Journal): Promise<Diagnostic | undefined> {',
        to: 'export async function restoreCaseRenames(dir: string, journal: Journal): Promise<Diagnostic | undefined> {\n  return undefined;',
      },
    ],
    caughtBy: [CASE_RENAME],
  },
];

test('control: the tests pass with the journal modules loaded through the mutant harness unchanged', { skip: underMutation() }, async () => {
  const mutations = [...new Map(MUTANTS.flatMap((m) => m.mutations).map((m) => [m.file, { file: m.file, from: m.from, to: m.from }])).values()];
  const run = await runUnderMutant(THIS_FILE, { name: 'identity', mutations, caughtBy: [] });
  assert.equal(run.code, 0, run.output.split('\n').slice(-40).join('\n'));
  assert.deepEqual(run.failed, []);
});

for (const mutant of MUTANTS) {
  test(`mutant caught: ${mutant.name}`, { skip: underMutation() }, async (t) => {
    const failed = await assertCaught(THIS_FILE, mutant);
    t.diagnostic(`failed under the mutant: ${failed.join('; ')}`);
  });
}
