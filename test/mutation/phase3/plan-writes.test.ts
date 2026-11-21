// Fault injection into the write policy (g3.checks-fail, architecture §6.4, §10, D17): a real project
// directory is planned against twice, once clean and once with one fault, through the package entry points
// as a command runs them (snapshot, planWrites, applyWrites). The faults: a foreign file outside the
// generated roots at a path the tree generates must give E_PATH_NOT_OWNED, and a reconciled file changed
// after its edits were planned must give E_STALE_EDIT; each refused plan applies nothing.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { type FileEntry, type WritePlan, planHasErrors, planWrites } from 'romlift';
import { applyWrites, readDiskState, readJournal, readManifest, readReconciledTexts, sha1Of } from 'romlift/node';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const C_TEXT = 'INCLUDE_ASM("asm/nonmatchings/main", Old);\n';

/** A generated file at a path outside the generated roots (a writer romlift does not ship, used as the probe). */
const OUTSIDE = 'tools/generated.s';

function tree(): readonly FileEntry[] {
  const at = C_TEXT.indexOf('Old');
  return [
    { ownership: 'generated', path: 'asm/main.s', text: '.include "asm/nonmatchings/main/New.s"\n', writer: 'module' },
    { ownership: 'generated', path: OUTSIDE, text: '@ generated\n', writer: 'objdiff' },
    {
      ownership: 'reconciled',
      path: 'src/main.c',
      baseSha1: sha1Of(C_TEXT),
      edits: [{ start: at, end: at + 3, text: 'New', reason: 'add-stub' }],
    },
  ];
}

async function project(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'romlift-mutation-'));
  roots.push(dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

async function plan(dir: string): Promise<WritePlan> {
  const entries = tree();
  const manifest = await readManifest(dir);
  const journal = await readJournal(dir);
  const disk = await readDiskState(
    dir,
    entries.map((e) => e.path),
  );
  const texts = await readReconciledTexts(dir, ['src/main.c']);
  assert.ok(manifest.ok && journal.ok && disk.ok && texts.ok);
  return planWrites({
    entries,
    manifest: manifest.value,
    journal: journal.value,
    disk: disk.value,
    reconciledTexts: texts.value,
    hash: sha1Of,
    retained: [],
  });
}

async function filesOf(dir: string, prefix = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await filesOf(dir, path));
    else out[path] = await readFile(join(dir, path), 'utf8');
  }
  return out;
}

/** Plans and applies; returns the plan, the apply result and whether the directory changed. */
async function attempt(
  dir: string,
): Promise<{ readonly plan: WritePlan; readonly ok: boolean; readonly changed: boolean }> {
  const before = await filesOf(dir);
  const p = await plan(dir);
  const applied = await applyWrites(dir, p);
  const after = await filesOf(dir);
  return { plan: p, ok: applied.ok, changed: JSON.stringify(before) !== JSON.stringify(after) };
}

test('unmutated, the plan has no error and applies', async () => {
  const dir = await project({ 'src/main.c': C_TEXT });
  const { plan: p, ok, changed } = await attempt(dir);
  assert.deepEqual(p.diagnostics, []);
  assert.ok(ok && changed);
  assert.equal(await readFile(join(dir, 'src/main.c'), 'utf8'), C_TEXT.replace('Old', 'New'));
  assert.equal(await readFile(join(dir, OUTSIDE), 'utf8'), '@ generated\n');
});

test('a foreign file outside the generated roots is E_PATH_NOT_OWNED, and nothing is applied', async () => {
  const dir = await project({ 'src/main.c': C_TEXT, [OUTSIDE]: '@ the user wrote this\n' });
  const { plan: p, ok, changed } = await attempt(dir);
  assert.deepEqual(
    p.diagnostics.map((d) => [d.code, d.path]),
    [['E_PATH_NOT_OWNED', OUTSIDE]],
  );
  assert.ok(planHasErrors(p));
  assert.ok(!p.ops.some((op) => op.path === OUTSIDE), 'no op for the refused path');
  assert.equal(ok, false);
  assert.equal(changed, false, 'the refused plan wrote nothing, not even its other ops or the manifest');
});

test('a reconciled file whose sha1 changed is E_STALE_EDIT, and nothing is applied', async () => {
  const dir = await project({ 'src/main.c': `${C_TEXT}int added_by_hand;\n` });
  const { plan: p, ok, changed } = await attempt(dir);
  assert.deepEqual(
    p.diagnostics.map((d) => [d.code, d.path]),
    [['E_STALE_EDIT', 'src/main.c']],
  );
  assert.ok(planHasErrors(p));
  assert.ok(!p.ops.some((op) => op.path === 'src/main.c'), 'no op for the stale file');
  assert.equal(ok, false);
  assert.equal(changed, false);
  assert.equal(await readFile(join(dir, 'src/main.c'), 'utf8'), `${C_TEXT}int added_by_hand;\n`);
});
