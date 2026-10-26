// renameInProject (architecture §2.1, §6.4, §6.6, D92) on projects `init` wrote: under the project lock it edits the
// identifier tokens of src/ and include/ through planEdits and applyWrites, then saves romlift.toml on one line; a
// symbolic link and a binary are never edited; a refusal, a held lock and an interrupted write's journal change no
// file; and a later `generate` carries the rename into the chunk files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../../src/cli/exit-codes.ts';
import { main } from '../../../../src/cli/main.ts';
import { renameInProject } from '../../../../src/shell/project/rename-project.ts';
import { listSyntheticFixtures } from '../../../helpers/fixtures.ts';
import { capturingIo } from '../../cli/fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-rename-project-'));
after(() => rm(TMP, { recursive: true, force: true }));
const COMPOSITE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
let fresh = 0;

async function run(cwd: string, argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stderr: io.err.join('') };
}

/** A project init wrote from the composite fixture, and its first plain default-named function of src/main.c. */
async function project(): Promise<{ readonly dir: string; readonly name: string }> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  const init = await run(dir, ['init', 'baserom.gba']);
  assert.equal(init.code, ExitCode.ok, init.stderr);
  const main = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  const name = /INCLUDE_ASM\("asm\/nonmatchings\/main", (sub_[0-9A-F]{8})\);/.exec(main)?.[1] ?? assert.fail('no stub in src/main.c');
  return { dir, name };
}

async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(dir, rel)) out.set(k, v);
    else out.set(rel, entry.isSymbolicLink() ? 'link' : createHash('sha1').update(await readFile(path.join(dir, rel))).digest('hex'));
  }
  return out;
}

test('a rename edits src/ and include/ identifiers and one TOML line, under the lock, and leaves no lock or journal', async () => {
  const { dir, name } = await project();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const manifest = await readFile(path.join(dir, '.romlift', 'manifest.json'), 'utf8');
  await mkdir(path.join(dir, 'src', 'sub'), { recursive: true });
  await writeFile(path.join(dir, 'src', 'sub', 'helper.h'), `/* ${name} */\nvoid ${name}(void);\n`);
  await writeFile(path.join(dir, 'include', 'game.h'), `#define CALL_IT ${name}()\nextern const char *gName; // "${name}"\n`);
  await writeFile(path.join(dir, 'include', 'blob.bin'), Buffer.from([0, 1, 2, ...Buffer.from(`${name}x`), 0]));
  await writeFile(path.join(TMP, `outside-${fresh}.c`), `void other(void);\n`);
  await symlink(path.join(TMP, `outside-${fresh}.c`), path.join(dir, 'src', 'linked.c'));
  const before = await snapshot(dir);

  const outcome = await renameInProject(path.join(dir, 'src'), name, 'GameInit');
  assert.ok(outcome.ok, outcome.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  assert.deepEqual(outcome.diagnostics.map((d) => [d.code, d.path]), [['W_RENAME_SKIPPED', 'include/blob.bin'], ['W_RENAME_SKIPPED', 'src/linked.c']], 'what rename leaves out is said (architecture-5)');
  assert.ok(outcome.applied && outcome.tomlWritten);
  assert.deepEqual(outcome.edits.map((e) => [e.path, e.edits.length]), [['include/game.h', 1], ['src/main.c', 1], ['src/sub/helper.h', 1]]);
  assert.deepEqual(outcome.ops.map((op) => `${op.op} ${op.path}`), ['edit include/game.h', 'edit src/main.c', 'edit src/sub/helper.h']);

  const after = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const a = toml.split('\n');
  const entry = a.find((line) => line.endsWith(` = "${name}"`)) ?? assert.fail(`no plain entry of ${name}`);
  assert.deepEqual(after.split('\n').filter((line, i) => line !== a[i]), [entry.replace(`"${name}"`, '"GameInit"')]);
  assert.ok((await readFile(path.join(dir, 'src', 'main.c'), 'utf8')).includes('INCLUDE_ASM("asm/nonmatchings/main", GameInit);'));
  assert.equal(await readFile(path.join(dir, 'src', 'sub', 'helper.h'), 'utf8'), `/* ${name} */\nvoid GameInit(void);\n`);
  assert.equal(await readFile(path.join(dir, 'include', 'game.h'), 'utf8'), `#define CALL_IT GameInit()\nextern const char *gName; // "${name}"\n`);
  assert.equal(await readFile(path.join(TMP, `outside-${fresh}.c`), 'utf8'), `void other(void);\n`, 'a linked file is never edited');
  const now = await snapshot(dir);
  assert.equal(now.get('src/linked.c'), 'link', 'the link is still a link');
  assert.equal(now.get('include/blob.bin'), before.get('include/blob.bin'), 'a binary is never edited');
  assert.equal(now.get('.romlift/lock'), undefined);
  assert.equal(now.get('.romlift/journal.json'), undefined);
  assert.equal(await readFile(path.join(dir, '.romlift', 'manifest.json'), 'utf8'), manifest, 'the manifest is unchanged');
  const changed = [...now].filter(([k, v]) => before.get(k) !== v).map(([k]) => k).sort();
  assert.deepEqual(changed, ['include/game.h', 'romlift.toml', 'src/main.c', 'src/sub/helper.h']);

  // generate carries it into the tree: the chunk file takes the new name, the old one goes.
  const generated = await run(dir, ['generate']);
  assert.equal(generated.code, ExitCode.ok, generated.stderr);
  const asm = await snapshot(dir, 'asm');
  assert.ok(asm.has('asm/nonmatchings/main/GameInit.s'));
  assert.ok(!asm.has(`asm/nonmatchings/main/${name}.s`));
});

test('a name the model emits that romlift.toml lacks (a local label) and a link that names the old name are refused, changing no file', async () => {
  const { dir, name } = await project();
  const chunks = await snapshot(dir, 'asm/nonmatchings');
  let local: string | undefined;
  for (const file of [...chunks.keys()].sort()) {
    local = /^(_[0-9A-F]{8}):/m.exec(await readFile(path.join(dir, file), 'utf8'))?.[1];
    if (local !== undefined) break;
  }
  assert.ok(local !== undefined, 'the composite has a local label');
  const before = await snapshot(dir);
  const emitted = await renameInProject(dir, name, local);
  assert.equal(emitted.ok, false);
  assert.deepEqual(emitted.diagnostics.map((d) => d.code), ['E_RENAME_EXISTS']);
  assert.deepEqual(await snapshot(dir), before);
  await writeFile(path.join(TMP, `named-${fresh}.h`), `void ${name}(void);\n`);
  await symlink(path.join(TMP, `named-${fresh}.h`), path.join(dir, 'include', 'named.h'));
  const linked = await snapshot(dir);
  const refused = await renameInProject(dir, name, 'GameInit');
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.diagnostics.map((d) => [d.code, d.path]), [['E_RENAME_SKIPPED_FILE', 'include/named.h']]);
  assert.deepEqual(await snapshot(dir), linked);
});

test('refusals change no file: an unknown old name, an existing new name, an invalid new name, no project', async () => {
  const { dir, name } = await project();
  const before = await snapshot(dir);
  const other = /^0x[0-9A-F]{8} = "(sub_[0-9A-F]{8})"$/gm;
  const names = [...(await readFile(path.join(dir, 'romlift.toml'), 'utf8')).matchAll(other)].map((m) => m[1]);
  const taken = names.find((n) => n !== name) ?? assert.fail('a second name');
  for (const [from, to, code] of [
    ['NoSuchName', 'X', 'E_RENAME_UNKNOWN'],
    [name, taken, 'E_RENAME_EXISTS'],
    [name, 'main', 'E_RENAME_EXISTS'],
    [name, 'not valid', 'E_RENAME_INVALID'],
  ] as const) {
    const outcome = await renameInProject(dir, from, to);
    assert.equal(outcome.ok, false);
    assert.deepEqual(outcome.diagnostics.map((d) => d.code), [code]);
    assert.deepEqual(await snapshot(dir), before, `${from} -> ${to} changed a file`);
  }
  const nowhere = path.join(TMP, `none-${fresh++}`);
  await mkdir(nowhere);
  assert.deepEqual((await renameInProject(nowhere, name, 'X')).diagnostics.map((d) => d.code), ['E_PROJECT_NOT_FOUND']);
});

test('a held lock is E_PROJECT_LOCKED, an interrupted write E_RENAME_INTERRUPTED; neither changes a file', async () => {
  const { dir, name } = await project();
  await writeFile(path.join(dir, '.romlift', 'lock'), `${JSON.stringify({ host: hostname(), pid: process.pid })}\n`);
  let before = await snapshot(dir);
  const locked = await renameInProject(dir, name, 'GameInit');
  assert.deepEqual(locked.diagnostics.map((d) => d.code), ['E_PROJECT_LOCKED']);
  assert.deepEqual(await snapshot(dir), before);
  await rm(path.join(dir, '.romlift', 'lock'));
  await writeFile(path.join(dir, '.romlift', 'journal.json'), `${JSON.stringify({ schema: 1, ops: [] })}\n`);
  before = await snapshot(dir);
  const interrupted = await renameInProject(dir, name, 'GameInit');
  assert.deepEqual(interrupted.diagnostics.map((d) => d.code), ['E_RENAME_INTERRUPTED']);
  assert.deepEqual(await snapshot(dir), before);
});

test('a name no text holds patches the TOML alone: no edit op, no journal written', async () => {
  const { dir } = await project();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const asmName = /0x08000000 = \{ name = "(sub_08000000)"/.exec(toml)?.[1] ?? assert.fail('the header function');
  const outcome = await renameInProject(dir, asmName, 'RomHeader');
  assert.ok(outcome.ok && outcome.tomlWritten && !outcome.applied);
  assert.deepEqual(outcome.edits, []);
  assert.ok((await readFile(path.join(dir, 'romlift.toml'), 'utf8')).includes('0x08000000 = { name = "RomHeader", mode = "arm" }'));
});
