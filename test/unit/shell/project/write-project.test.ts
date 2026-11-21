// Writing a project (shell/project/write-project.ts) on temporary directories: init's write (the ROM copied to the
// plan's romCopy, the plan's own files saved: the TOML and decomp.yaml; the tree and the scaffold applied, setup.sh
// executable), a write of other own files than init's two, which the shell writes and hashes as given (architecture-a2-6), a second tree write that changes
// nothing and so applies nothing (the manifest keeps its modification time), a dry run that touches nothing, and an
// existing romlift.toml that differs from init's, which init's write never replaces and, under the lock, refuses (the
// check is the write's own since fix round 3: it cannot be skipped, D78 f).
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { init } from '../../../../src/core/workflow/init.ts';
import { readScaffoldInputs } from '../../../../src/shell/project/read-inputs.ts';
import { writeInitProject, writeTree } from '../../../../src/shell/project/write-project.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-write-project-'));
after(() => rm(TMP, { recursive: true, force: true }));
const FIXTURE = listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump');
const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error('the package templates do not read');
const S = scaffold.value;
const ROM = readFixtureRom(FIXTURE);
const PLAN = init({
  rom: ROM,
  romFile: 'far-jump.gba',
  options: {},
  templates: S.templates,
  romliftVersion: S.romliftVersion,
  agbcc: S.agbcc,
});
if (!PLAN.ok) throw new Error('init refused the fixture');
const P = PLAN;

test("init's write, then a tree write that changes nothing and applies nothing, and a dry run", async () => {
  const dir = path.join(TMP, 'a');
  const files = { romPath: FIXTURE.rom, romCopy: P.romCopy, files: P.files };
  assert.deepEqual(
    P.files.map(([p]) => p),
    ['romlift.toml', 'decomp.yaml'],
  );
  assert.equal(P.romCopy, 'baserom.gba');
  const written = await writeInitProject(
    dir,
    files,
    { rom: ROM, result: P.result, extra: P.scaffold },
    S.romliftVersion,
  );
  assert.ok(
    written.ok && written.value.applied,
    written.ok ? '' : written.diagnostics.map((d) => d.message).join('; '),
  );
  assert.deepEqual(await readFile(path.join(dir, 'baserom.gba')), await readFile(FIXTURE.rom));
  assert.equal(await readFile(path.join(dir, 'romlift.toml'), 'utf8'), P.tomlText);
  for (const [file, text] of P.files) assert.equal(await readFile(path.join(dir, file), 'utf8'), text);
  assert.equal((await stat(path.join(dir, 'setup.sh'))).mode & 0o111, 0o111);
  const manifest = await stat(path.join(dir, '.romlift', 'manifest.json'));
  const again = await writeTree(dir, { rom: ROM, result: P.result }, S.romliftVersion, false);
  assert.ok(again.ok && !again.value.applied);
  assert.ok(again.value.plan.ops.every((op) => op.op === 'keep'));
  assert.equal((await stat(path.join(dir, '.romlift', 'manifest.json'))).mtimeMs, manifest.mtimeMs);
  await rm(path.join(dir, 'symbols.ld'));
  const dry = await writeTree(dir, { rom: ROM, result: P.result }, S.romliftVersion, true);
  assert.ok(dry.ok && !dry.value.applied);
  assert.deepEqual(
    dry.value.plan.ops.filter((op) => op.op !== 'keep').map((op) => `${op.op} ${op.path}`),
    ['write symbols.ld'],
  );
  await assert.rejects(stat(path.join(dir, 'symbols.ld')));
});

test("init's own files are the plan's: the shell writes and hashes the [path, text] pairs and the ROM copy it is given", async () => {
  const dir = path.join(TMP, 'b');
  const files = {
    romPath: FIXTURE.rom,
    romCopy: 'rom-copy.gba',
    files: [...P.files, ['notes.txt', 'owned by the plan\n'] as const],
  };
  const written = await writeInitProject(
    dir,
    files,
    { rom: ROM, result: P.result, extra: P.scaffold },
    S.romliftVersion,
  );
  assert.ok(written.ok && written.value.applied);
  assert.deepEqual(await readFile(path.join(dir, 'rom-copy.gba')), await readFile(FIXTURE.rom));
  await assert.rejects(stat(path.join(dir, 'baserom.gba')), 'the shell knows no file name of its own');
  assert.equal(await readFile(path.join(dir, 'notes.txt'), 'utf8'), 'owned by the plan\n');
  await writeFile(path.join(dir, 'notes.txt'), 'changed\n');
  const refused = await writeInitProject(
    dir,
    files,
    { rom: ROM, result: P.result, extra: P.scaffold },
    S.romliftVersion,
  );
  assert.ok(!refused.ok && refused.refused);
  assert.deepEqual(
    refused.diagnostics.map((d) => [d.code, d.path]),
    [['E_DIR_NOT_EMPTY', 'notes.txt']],
  );
});

test("init's write checks its own files under the lock: a romlift.toml that differs from init's refuses the write (E_DIR_NOT_EMPTY)", async () => {
  const dir = path.join(TMP, 'c');
  const files = { romPath: FIXTURE.rom, romCopy: P.romCopy, files: P.files };
  const first = await writeInitProject(dir, files, { rom: ROM, result: P.result, extra: P.scaffold }, S.romliftVersion);
  assert.ok(first.ok && first.value.applied);
  const again = await writeInitProject(dir, files, { rom: ROM, result: P.result, extra: P.scaffold }, S.romliftVersion);
  assert.ok(again.ok, 'the files init wrote are what it would write: a repeated init is fine');
  await writeFile(path.join(dir, 'romlift.toml'), '# changed after the command looked\n');
  await rm(path.join(dir, 'symbols.ld'));
  const refused = await writeInitProject(
    dir,
    files,
    { rom: ROM, result: P.result, extra: P.scaffold },
    S.romliftVersion,
  );
  assert.ok(!refused.ok && refused.refused, 'a refusal of the directory check, which the command prints alone');
  assert.deepEqual(
    refused.diagnostics.map((d) => [d.code, d.path]),
    [['E_DIR_NOT_EMPTY', 'romlift.toml']],
  );
  assert.equal(
    await readFile(path.join(dir, 'romlift.toml'), 'utf8'),
    '# changed after the command looked\n',
    'never replaced',
  );
  await assert.rejects(stat(path.join(dir, 'symbols.ld')), 'nothing was written');
});
