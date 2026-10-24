// What the one-shot commands read (shell/project/read-inputs.ts), on temporary directories: init's directory as a
// listing (absent, empty, the ROM with .git and dot-files, a file, a project), a project read from any directory inside
// it (decomp.yaml, romlift.toml, the ROM, src/*.c; --rom; no project), the write state planWrites needs, the package's
// scaffold inputs and version, and the digests init compares. What core/workflow/init.ts decides from the listing and
// the digests (initDirVerdict, replacedProblems) is tested in test/unit/workflow/init.test.ts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync, unlinkSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { renderDecompYaml } from '../../../../src/core/config/decomp-yaml.ts';
import { serializeConfig } from '../../../../src/core/config/serialize.ts';
import { configFromDiscover } from '../../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../../src/core/workflow/discover.ts';
import type { InitDirListing } from '../../../../src/core/workflow/init.ts';
import { encodeManifest } from '../../../../src/core/write-plan/manifest.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import {
  packageRoot,
  packageVersion,
  readChunkFiles,
  readCTexts,
  readDigests,
  readHeaderTexts,
  readInitDir,
  readProject,
  readProjectTexts,
  readScaffoldInputs,
  readWriteState,
} from '../../../../src/shell/project/read-inputs.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-read-inputs-'));
after(() => rm(TMP, { recursive: true, force: true }));
const FIXTURE = listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump');
let fresh = 0;

async function dirWith(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = path.join(TMP, `d${fresh++}`);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return dir;
}

/** A minimal project of the far-jump fixture: its ROM, romlift.toml, decomp.yaml and one C file. */
async function project(): Promise<{ readonly dir: string; readonly toml: string }> {
  const rom = readFixtureRom(FIXTURE);
  const config = configFromDiscover(rom, discover(rom));
  const toml = serializeConfig(config);
  const dir = await dirWith({
    'romlift.toml': toml,
    'decomp.yaml': renderDecompYaml({ name: config.build.name, title: rom.header.title, gameCode: rom.header.gameCode, sha1: rom.sha1 }),
    'src/main.c': '#include "include_asm.h"\n',
    'src/notes.txt': 'not C',
    'src/deep/other.c': 'not read',
  });
  await copyFile(FIXTURE.rom, path.join(dir, 'baserom.gba'));
  return { dir, toml };
}

/** readInitDir's listing of `dir` for the ROM `rom`. */
async function listing(dir: string, rom: string): Promise<InitDirListing> {
  const read = await readInitDir(dir, rom);
  assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
  return read.value;
}

test("readInitDir: an absent path, an empty directory, the ROM inside with .git and dot-files, other entries, a file", async () => {
  const absentDir = path.join(TMP, 'not-yet');
  assert.deepEqual(await listing(absentDir, path.join(TMP, 'x.gba')), { dir: absentDir, state: 'absent', names: [] });
  const emptyDir = await dirWith({});
  assert.deepEqual(await listing(emptyDir, '/elsewhere/rom.gba'), { dir: emptyDir, state: 'directory', names: [] });
  const romDir = await dirWith({ 'game.gba': 'x', '.DS_Store': '', '.git/HEAD': 'ref' });
  assert.deepEqual(await listing(romDir, path.join(romDir, 'game.gba')), { dir: romDir, romInside: 'game.gba', state: 'directory', names: ['.DS_Store', '.git', 'game.gba'] });
  const crowded = await dirWith({ 'game.gba': 'x', 'another.gba': 'y' });
  assert.deepEqual(await listing(crowded, path.join(crowded, 'game.gba')), { dir: crowded, romInside: 'game.gba', state: 'directory', names: ['another.gba', 'game.gba'] });
  const file = path.join(crowded, 'game.gba');
  assert.deepEqual(await listing(file, file), { dir: file, state: 'not-directory', names: [] });
});

test("readInitDir: a romlift project's entries, with the ROM inside", async () => {
  const { dir } = await project();
  const listed = await listing(dir, path.join(dir, 'baserom.gba'));
  assert.equal(listed.state, 'directory');
  assert.equal(listed.romInside, 'baserom.gba');
  assert.deepEqual(listed.names, ['baserom.gba', 'decomp.yaml', 'romlift.toml', 'src']);
});

test('readProject from a subdirectory: the config, its text, the ROM and src/*.c (not deeper, not other files)', async () => {
  const { dir, toml } = await project();
  await mkdir(path.join(dir, 'asm', 'deep'), { recursive: true });
  const read = await readProject(path.join(dir, 'asm', 'deep'));
  assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
  assert.equal(await realpath(read.value.dir), await realpath(dir));
  assert.equal(read.value.inputs.configText, toml);
  assert.equal(read.value.inputs.rom.sha1, read.value.inputs.config.rom.sha1);
  assert.deepEqual([...read.value.inputs.cTexts.keys()], ['src/main.c']);
  const withoutC = await readProject(dir, { withoutC: true });
  assert.ok(withoutC.ok && withoutC.value.inputs.cTexts.size === 0);
});

test('readProject: --rom reads another file; a missing ROM is E_IO_READ; outside a project E_PROJECT_NOT_FOUND', async () => {
  const { dir } = await project();
  await rm(path.join(dir, 'baserom.gba'));
  const missing = await readProject(dir);
  assert.ok(!missing.ok && missing.diagnostics[0]?.code === 'E_IO_READ');
  const other = await readProject(dir, { rom: FIXTURE.rom });
  assert.ok(other.ok && other.value.romPath === FIXTURE.rom);
  const none = await readProject(await dirWith({}));
  assert.ok(!none.ok && none.diagnostics[0]?.code === 'E_PROJECT_NOT_FOUND');
});

test('readCTexts: no src/ is no C; readProjectTexts reads the paths that exist', async () => {
  const empty = await readCTexts(await dirWith({}));
  assert.ok(empty.ok && empty.value.size === 0);
  const dir = await dirWith({ 'Makefile': 'all:\n' });
  const texts = await readProjectTexts(dir, ['Makefile', 'README.md']);
  assert.ok(texts.ok);
  assert.deepEqual([...texts.value], [['Makefile', 'all:\n']]);
});

test('readWriteState: the manifest, no journal, and the digest of the given paths, the manifest paths and the generated roots', async () => {
  const dir = await dirWith({ 'asm/a.s': 'a\n', 'asm/stray.s': 's\n', 'Makefile': 'm\n' });
  await mkdir(path.join(dir, '.romlift'));
  const manifest = { schema: 1 as const, romlift: '0.0.0', files: { 'asm/a.s': { sha1: sha1Of('a\n'), writer: 'function' as const }, 'asm/gone.s': { sha1: sha1Of('g'), writer: 'function' as const } } };
  await writeFile(path.join(dir, '.romlift', 'manifest.json'), [...encodeManifest(manifest)].join(''));
  const state = await readWriteState(dir, ['Makefile', 'ldscript.txt']);
  assert.ok(state.ok);
  assert.deepEqual(state.value.manifest, manifest);
  assert.equal(state.value.journal, null);
  assert.deepEqual(Object.fromEntries(state.value.disk), {
    Makefile: { kind: 'present', sha1: sha1Of('m\n') },
    'asm/a.s': { kind: 'present', sha1: sha1Of('a\n') },
    'asm/gone.s': { kind: 'absent' },
    'asm/stray.s': { kind: 'present', sha1: sha1Of('s\n') },
    'ldscript.txt': { kind: 'absent' },
  });
});

test("the package's scaffold inputs: the manifest's templates, the agbcc pin and package.json's version", async () => {
  const read = await readScaffoldInputs();
  assert.ok(read.ok);
  assert.ok(read.value.templates.manifest.files.some((f) => f.target === 'setup.sh' && f.executable));
  assert.match(read.value.agbcc.commit, /^[0-9a-f]{40}$/);
  const version = await packageVersion();
  assert.ok(version.ok && version.value === read.value.romliftVersion);
  assert.ok(path.isAbsolute(packageRoot()));
  const nowhere = await readScaffoldInputs(await dirWith({}));
  assert.ok(!nowhere.ok && nowhere.diagnostics[0]?.code === 'E_IO_READ');
});

test('readDigests: the sha1 of each file that exists, absent for one that does not, in the order asked', async () => {
  const dir = await dirWith({ 'romlift.toml': 'a = 1\n', 'baserom.gba': 'ROM' });
  const current = await readDigests(dir, ['romlift.toml', 'decomp.yaml', 'baserom.gba']);
  assert.ok(current.ok);
  assert.deepEqual([...current.value], [['romlift.toml', { kind: 'present', sha1: sha1Of('a = 1\n') }], ['decomp.yaml', { kind: 'absent' }], ['baserom.gba', { kind: 'present', sha1: sha1Of('ROM') }]]);
});

// Fix round 4 (architecture-a2-4): the reader of the previous tree, which the C reconciliation keys on (D78 a, D80 a).

test('readChunkFiles: no asm/nonmatchings is no tree; only the .s files of each module directory are listed', async () => {
  const none = await readChunkFiles(await dirWith({}));
  assert.ok(none.ok);
  assert.deepEqual(none.value, []);
  const dir = await dirWith({
    'asm/nonmatchings/main/sub_08000100.s': '',
    'asm/nonmatchings/main/Foo.s': '',
    'asm/nonmatchings/main/notes.txt': 'not a chunk',
    'asm/nonmatchings/main/deeper/sub_08000200.s': 'one level only',
    'asm/nonmatchings/stray.s': 'not in a module directory',
    'asm/nonmatchings/main_2/sub_08000300.s': '',
  });
  const read = await readChunkFiles(dir);
  assert.ok(read.ok);
  assert.deepEqual(read.value, ['asm/nonmatchings/main/Foo.s', 'asm/nonmatchings/main/sub_08000100.s', 'asm/nonmatchings/main_2/sub_08000300.s']);
  const file = await dirWith({ 'asm/nonmatchings': 'a file, not a directory' });
  const notDir = await readChunkFiles(file);
  assert.ok(notDir.ok);
  assert.deepEqual(notDir.value, []);
});

test('readProject passes the chunk files on disk as previousChunkFiles, and none with withoutC', async () => {
  const { dir } = await project();
  const before = await readProject(dir);
  assert.ok(before.ok);
  assert.deepEqual(before.value.inputs.previousChunkFiles, [], 'no asm/ yet: the first generate of a clone');
  await mkdir(path.join(dir, 'asm', 'nonmatchings', 'main'), { recursive: true });
  await writeFile(path.join(dir, 'asm', 'nonmatchings', 'main', 'sub_08000100.s'), '');
  const read = await readProject(dir);
  assert.ok(read.ok);
  assert.deepEqual(read.value.inputs.previousChunkFiles, ['asm/nonmatchings/main/sub_08000100.s']);
  const withoutC = await readProject(dir, { withoutC: true });
  assert.ok(withoutC.ok);
  assert.equal(withoutC.value.inputs.previousChunkFiles, undefined);
});

// Fix round 5 (architecture-b0-6): a tree that cannot be read is an error, never "no previous tree".
test('readChunkFiles: an asm/ or module directory it cannot examine or list is E_IO_READ', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async () => {
  const dir = await dirWith({ 'asm/nonmatchings/main/sub_08000100.s': '' });
  for (const locked of [path.join(dir, 'asm'), path.join(dir, 'asm', 'nonmatchings'), path.join(dir, 'asm', 'nonmatchings', 'main')]) {
    await chmod(locked, 0o000);
    try {
      const read = await readChunkFiles(dir);
      assert.equal(read.ok, false, locked);
      assert.ok(!read.ok && read.diagnostics.some((d) => d.code === 'E_IO_READ'), locked);
    } finally {
      await chmod(locked, 0o755);
    }
  }
});

// Fix round 11 (architecture-d0-3): the headers the C reconciliation follows (IncludeAsmWanted.headers, D87 c).

test('readHeaderTexts: no include/ or src/ is an empty map; every file under include/ and every .h under src/, at any depth, by project path', async () => {
  const none = await readHeaderTexts(await dirWith({}));
  assert.ok(none.ok);
  assert.deepEqual([...none.value], []);
  const dir = await dirWith({
    'include/global.h': '#include "gba/gba.h"\n',
    'include/gba/gba.h': '#define X 1\n',
    'include/gba/deep/io_reg.h': '',
    'include/macros.inc': '.macro m\n.endm\n',
    'src/main.c': 'not a header',
    'src/local.h': '#define INCLUDE_ASM(DIR, NAME)\n',
    'src/sub/inner.h': '',
    'src/sub/inner.c': 'not a header',
    'asm/x.h': 'not under include/ or src/',
  });
  const read = await readHeaderTexts(dir);
  assert.ok(read.ok);
  assert.deepEqual([...read.value.keys()], ['include/gba/deep/io_reg.h', 'include/gba/gba.h', 'include/global.h', 'include/macros.inc', 'src/local.h', 'src/sub/inner.h']);
  assert.equal(read.value.get('include/global.h'), '#include "gba/gba.h"\n');
  const file = await readHeaderTexts(await dirWith({ include: 'a file, not a directory' }));
  assert.ok(file.ok);
  assert.deepEqual([...file.value], []);
});

// Fix round 12 (correctness-d1-1, architecture-d1-1, gate-honesty-d1-1): links are followed, as the scaffold's cpp
// follows them, though not exactly as cpp resolves includes (D89 a, D90 a); fix round 11's lstat walk read nothing
// behind a link to a directory, and a module renamed with git mv whose defining global.h sat behind one gained a second
// include_asm.h.

test('readHeaderTexts follows a symbolic link into a directory: a linked subdirectory of include/ or src/, a second path to a directory, a link to a file; a cycle ends; a dangling link or a link loop is left out', async () => {
  const shared = await dirWith({ 'gba/macro.h': 'm', 'src/x.h': 'x', 'src/y.c': 'not a header' });
  const dir = await dirWith({ 'include/global.h': 'g', 'include/real/types.h': 't' });
  await symlink('.', path.join(dir, 'include', 'a'));
  await symlink('.', path.join(dir, 'include', 'b'));
  await symlink('..', path.join(dir, 'include', 'up'));
  await symlink('real', path.join(dir, 'include', 'alias'));
  await symlink(path.join(shared, 'gba'), path.join(dir, 'include', 'gba'));
  await symlink('real/types.h', path.join(dir, 'include', 'types.h'));
  await symlink('missing.h', path.join(dir, 'include', 'dangling.h'));
  await symlink('loop.h', path.join(dir, 'include', 'loop.h'));
  await mkdir(path.join(dir, 'src'));
  await symlink(path.join(shared, 'src'), path.join(dir, 'src', 'sub'));
  const read = await readHeaderTexts(dir);
  assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual([...read.value], [
    ['include/alias/types.h', 't'],
    ['include/gba/macro.h', 'm'],
    ['include/global.h', 'g'],
    ['include/real/types.h', 't'],
    ['include/types.h', 't'],
    ['src/sub/x.h', 'x'],
  ]);
});

test('readHeaderTexts follows include/ and src/ that are themselves links; one to the project directory ends there', async () => {
  const shared = await dirWith({ 'include/global.h': 'g', 'include/sub/a.h': 'a', 'src/local.h': 'l', 'src/main.c': 'not a header' });
  const dir = await dirWith({});
  await symlink(path.join(shared, 'include'), path.join(dir, 'include'));
  await symlink(path.join(shared, 'src'), path.join(dir, 'src'));
  const read = await readHeaderTexts(dir);
  assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual([...read.value], [['include/global.h', 'g'], ['include/sub/a.h', 'a'], ['src/local.h', 'l']]);
  const self = await dirWith({ 'global.h': 'g' });
  await symlink('.', path.join(self, 'include'));
  const selfRead = await readHeaderTexts(self);
  assert.ok(selfRead.ok);
  assert.deepEqual([...selfRead.value], [], 'include -> . is the project directory: a cycle, walked no further');
});

test('readHeaderTexts returns promptly when a followed link reaches a FIFO: it is not listed, not read (gate-honesty-e1-2)', { skip: process.platform === 'win32' ? 'mkfifo is POSIX' : false }, async () => {
  const shared = await dirWith({ 'gba/macro.h': 'm' });
  const pipe = path.join(shared, 'gba', 'pipe.h');
  execFileSync('mkfifo', [pipe]);
  const dir = await dirWith({ 'include/global.h': 'g' });
  await symlink(path.join(shared, 'gba'), path.join(dir, 'include', 'gba'));
  await mkdir(path.join(dir, 'src'));
  await symlink(pipe, path.join(dir, 'src', 'pipe.h'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('readHeaderTexts did not return within 5 s: it read the FIFO')), 5000);
  });
  try {
    const read = await Promise.race([readHeaderTexts(dir), timeout]);
    assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
    assert.deepEqual([...read.value], [
      ['include/gba/macro.h', 'm'],
      ['include/global.h', 'g'],
    ]);
  } finally {
    clearTimeout(timer);
    // A reader blocked on the FIFO (the defect) gets end of file, and the FIFO goes in the same tick, so the next open
    // (through the other link) finds nothing: a failure fails instead of hanging the process.
    try {
      closeSync(openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch {
      // ENXIO: nothing reads it, as it should be.
    }
    unlinkSync(pipe);
  }
});

// Fix round 14 (architecture-e0-2, D90 a): the recorded third layout. A link to a directory above the project is
// entered and every file under it read, but for the project directory below it, where the walk is already inside.
test('readHeaderTexts enters a link to a directory above the project, all of it but the project directory', async () => {
  const outer = await dirWith({ 'other/x.h': 'x', 'blob.bin': 'b' });
  const dir = path.join(outer, 'proj');
  await mkdir(path.join(dir, 'include'), { recursive: true });
  await writeFile(path.join(dir, 'include', 'global.h'), 'g');
  await symlink(path.join('..', '..'), path.join(dir, 'include', 'up'));
  const read = await readHeaderTexts(dir);
  assert.ok(read.ok, read.ok ? '' : read.diagnostics.map((d) => d.message).join('; '));
  assert.deepEqual([...read.value], [
    ['include/global.h', 'g'],
    ['include/up/blob.bin', 'b'],
    ['include/up/other/x.h', 'x'],
  ]);
});

test('readHeaderTexts: an include/ or src/ directory it cannot list, or a header it cannot read, is E_IO_READ', { skip: process.getuid?.() === 0 ? 'root reads through mode 000' : false }, async () => {
  const dir = await dirWith({ 'include/gba/gba.h': '', 'src/sub/a.h': '' });
  for (const locked of [path.join(dir, 'include'), path.join(dir, 'include', 'gba'), path.join(dir, 'src', 'sub'), path.join(dir, 'include', 'gba', 'gba.h')]) {
    await chmod(locked, 0o000);
    try {
      const read = await readHeaderTexts(dir);
      assert.equal(read.ok, false, locked);
      assert.ok(!read.ok && read.diagnostics.some((d) => d.code === 'E_IO_READ'), locked);
    } finally {
      await chmod(locked, locked.endsWith('.h') ? 0o644 : 0o755);
    }
  }
});

test('readProject passes the headers as headerTexts, and none with withoutC', async () => {
  const { dir } = await project();
  const before = await readProject(dir);
  assert.ok(before.ok);
  assert.deepEqual([...(before.value.inputs.headerTexts ?? new Map())], [], 'no include/ and no src/*.h');
  await mkdir(path.join(dir, 'include'), { recursive: true });
  await writeFile(path.join(dir, 'include', 'global.h'), '#define INCLUDE_ASM(DIR, NAME)\n');
  await writeFile(path.join(dir, 'src', 'local.h'), '');
  const read = await readProject(dir);
  assert.ok(read.ok);
  assert.deepEqual([...(read.value.inputs.headerTexts ?? new Map()).keys()], ['include/global.h', 'src/local.h']);
  const withoutC = await readProject(dir, { withoutC: true });
  assert.ok(withoutC.ok);
  assert.equal(withoutC.value.inputs.headerTexts, undefined);
});
