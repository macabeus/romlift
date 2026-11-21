// `romlift init <rom> [dir] [--name] [--module-size] [--no-signatures] [--json]` (architecture §2.1, §6.3 to §6.5, §7.3) on temporary
// directories: the project it writes (the ROM copied to baserom.gba with the original kept, romlift.toml, decomp.yaml,
// the scaffold with setup.sh executable, src/*.c, the tree and its manifest), the lock step deferred without npm, a
// second run in the project changing nothing, the directory rule (E_DIR_NOT_EMPTY, nothing written), a changed TOML
// refused, and the usage and input errors.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { parseModuleSize } from '../../../src/cli/commands/init.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-init-'));
after(() => rm(TMP, { recursive: true, force: true }));
const COMPOSITE = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
let fresh = 0;

async function run(
  cwd: string,
  argv: readonly string[],
): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

async function romDir(): Promise<string> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(COMPOSITE.rom, path.join(dir, 'composite.gba'));
  return dir;
}

/** Every file under `dir` (but .git) with its bytes' length and modification time. */
async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(dir, relative)) out.set(k, v);
    else
      out.set(
        relative,
        `${(await readFile(path.join(dir, relative))).toString('base64')} ${(await stat(path.join(dir, relative))).mtimeMs}`,
      );
  }
  return out;
}

test('init in a directory holding only the ROM writes the whole project; the lock step is deferred without npm', async () => {
  const dir = await romDir();
  const out = await run(dir, ['init', 'composite.gba', '--module-size', '0x200', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const parsed = lines(out.stdout);
  const summary = parsed.at(-1);
  assert.equal(summary?.['type'], 'summary');
  assert.equal(summary?.['exitCode'], 0);
  assert.ok(
    parsed.some((l) => l['code'] === 'W_LOCKFILE_DEFERRED'),
    'capturingIo has no PATH, so npm is not found',
  );
  const rom = await readFile(COMPOSITE.rom);
  assert.deepEqual(await readFile(path.join(dir, 'baserom.gba')), rom);
  assert.deepEqual(await readFile(path.join(dir, 'composite.gba')), rom, 'the original stays');
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const config = parseConfig(toml);
  assert.ok(config.ok);
  const name = config.value.build.name;
  for (const file of [
    'decomp.yaml',
    'Makefile',
    'setup.sh',
    'AGENTS.md',
    '.gitignore',
    '.gitmodules',
    `${name}.sha1`,
    'package.json',
    'include/include_asm.h',
    'include/macros.inc',
    'mk/agbcc.mk',
    'ldscript.txt',
    'symbols.ld',
    'modules.mk',
    'src/main.c',
    '.romlift/manifest.json',
  ]) {
    assert.ok((await stat(path.join(dir, file))).isFile(), file);
  }
  assert.equal((await stat(path.join(dir, 'setup.sh'))).mode & 0o111, 0o111, 'setup.sh is executable');
  assert.equal((await stat(path.join(dir, 'Makefile'))).mode & 0o111, 0);
  await assert.rejects(stat(path.join(dir, '.romlift', 'lock')), 'the lock is released');
  await assert.rejects(stat(path.join(dir, '.romlift', 'journal.json')), 'the journal is removed');
  assert.ok(config.value.modules.length > 3, '--module-size 0x200 reached the inference');
  const counts = summary?.['counts'] as Record<string, number>;
  assert.equal(counts['functions'], config.value.functions.size);
  assert.equal(counts['entry_points'], config.value.entryPoints.size);
});

test('init a second time in the project changes no file', async () => {
  const dir = await romDir();
  assert.equal((await run(dir, ['init', 'composite.gba'])).code, ExitCode.ok);
  const before = await snapshot(dir);
  const again = await run(dir, ['init', 'composite.gba', '--json']);
  assert.equal(again.code, ExitCode.ok, again.stdout);
  assert.deepEqual(await snapshot(dir), before);
});

test('init into a named directory, created when absent; text mode says what to run next', async () => {
  const dir = path.join(TMP, `new-${fresh++}`, 'project');
  const out = await run(TMP, ['init', COMPOSITE.rom, dir, '--name', 'demo']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  assert.match(
    out.stdout,
    /initialised demo in .*: romlift\.toml, decomp\.yaml, the scaffold and the tree; run \.\/setup\.sh, then make\n/,
  );
  assert.match(out.stdout, /^init: ok \(exit 0\): /m);
  assert.equal(
    await readFile(path.join(dir, 'demo.sha1'), 'utf8'),
    `${(await readFile(path.join(dir, 'decomp.yaml'), 'utf8')).match(/sha1: "([0-9a-f]{40})"/)?.[1] ?? '?'}  demo.gba\n`,
  );
});

test('a directory with another file is E_DIR_NOT_EMPTY (exit 1) and nothing is written', async () => {
  const dir = await romDir();
  await writeFile(path.join(dir, 'notes.txt'), 'mine');
  const before = await snapshot(dir);
  const out = await run(dir, ['init', 'composite.gba', '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.deepEqual(
    lines(out.stdout).map((l) => l['code'] ?? l['type']),
    ['E_DIR_NOT_EMPTY', 'summary'],
  );
  assert.deepEqual(await snapshot(dir), before);
});

test('a project whose romlift.toml was edited is not re-initialised: E_DIR_NOT_EMPTY', async () => {
  const dir = await romDir();
  assert.equal((await run(dir, ['init', 'composite.gba'])).code, ExitCode.ok);
  await writeFile(path.join(dir, 'romlift.toml'), `# mine\n${await readFile(path.join(dir, 'romlift.toml'), 'utf8')}`);
  const out = await run(dir, ['init', 'composite.gba', '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.equal(lines(out.stdout)[0]?.['code'], 'E_DIR_NOT_EMPTY');
  assert.match(String(lines(out.stdout)[0]?.['message']), /romlift\.toml differs/);
});

test('usage errors exit 2; a colliding --name, a missing file and an image that is not a cartridge exit 1', async () => {
  const dir = await romDir();
  assert.equal((await run(dir, ['init'])).code, ExitCode.usage);
  assert.equal((await run(dir, ['init', 'composite.gba', '--module-size', '0x201'])).code, ExitCode.usage);
  assert.equal((await run(dir, ['init', 'composite.gba', 'a', 'b'])).code, ExitCode.usage);
  const named = await run(dir, ['init', 'composite.gba', '--name', 'composite', '--json']);
  assert.equal(named.code, ExitCode.errors);
  assert.equal(lines(named.stdout)[0]?.['code'], 'E_NAME_INVALID');
  const crowded = await run(dir, ['init', 'absent.gba', '--json']);
  assert.equal(lines(crowded.stdout)[0]?.['code'], 'E_DIR_NOT_EMPTY', 'composite.gba is not the ROM given');
  const empty = path.join(TMP, `empty-${fresh++}`);
  await mkdir(empty);
  const missing = await run(empty, ['init', 'absent.gba', '--json']);
  assert.equal(missing.code, ExitCode.errors);
  assert.equal(lines(missing.stdout)[0]?.['code'], 'E_IO_READ');
  const junk = path.join(TMP, `junk-${fresh++}`);
  await mkdir(junk);
  await writeFile(path.join(junk, 'junk.gba'), new Uint8Array(0x40));
  const notRom = await run(junk, ['init', 'junk.gba', '--json']);
  assert.equal(notRom.code, ExitCode.errors);
  assert.equal(lines(notRom.stdout)[0]?.['code'], 'E_ROM_NOT_GBA');
  assert.deepEqual((await readdir(junk)).sort(), ['junk.gba']);
});

test('parseModuleSize: 0x… or decimal, a positive multiple of 4 up to 32 MiB', () => {
  assert.equal(parseModuleSize('0x200'), 0x200);
  assert.equal(parseModuleSize('4096'), 4096);
  for (const bad of ['0', '0x0', '6', '0x201', 'x200', '-4', '0x4000000', ''])
    assert.equal(parseModuleSize(bad), undefined, bad);
});

// ---------------------------------------------------------------------------------------------------
// Signatures (phase 6, architecture §7.3, D93): located from $ROMLIFT_SIGNATURES (here a temporary directory, so no
// file built on this machine reaches the test), W_SIGNATURES_ABSENT when it holds none, --no-signatures.

const GAME = listSyntheticFixtures().find((f) => f.name === 'library-game') ?? assert.fail('library-game');
const NO_SIGNATURES = path.join(TMP, 'no-signatures');
const WITH_LIBFIX = path.join(TMP, 'with-libfix');
await mkdir(NO_SIGNATURES, { recursive: true });
await mkdir(WITH_LIBFIX, { recursive: true });
await copyFile(path.join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), path.join(WITH_LIBFIX, 'libfix.json'));

async function runWith(
  cwd: string,
  argv: readonly string[],
  signatures: string,
): Promise<{ readonly code: ExitCode; readonly stdout: string }> {
  const io = { ...capturingIo(), cwd, env: { ROMLIFT_SIGNATURES: signatures } };
  const code = await main(argv, io);
  return { code, stdout: io.out.join('') };
}

async function gameDir(): Promise<string> {
  const dir = path.join(TMP, `g${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(GAME.rom, path.join(dir, 'game.gba'));
  return dir;
}

test('init with a signature directory: the libraries it places are named, with from, a library module and [signatures] libraries', async () => {
  const dir = await gameDir();
  const out = await runWith(dir, ['init', 'game.gba', '--json'], WITH_LIBFIX);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.ok(!lines(out.stdout).some((l) => l['code'] === 'W_SIGNATURES_ABSENT'));
  assert.ok(lines(out.stdout).some((l) => l['code'] === 'W_SIGNATURE_CONSTANT'));
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  assert.match(toml, /\[signatures\]\nenabled = true\nlibraries = \["libfix"\]\n/);
  assert.match(toml, /^0x08000244 = \{ name = "FixAbs", from = "sig:libfix@1\.0" \}$/m);
  assert.match(toml, /name = "libfix"\nstart = 0x080001B4\nkind = "asm"\nlibrary = "libfix"\nversion = "1\.0"/);
  assert.ok(
    (await stat(path.join(dir, 'asm', 'nonmatchings', 'libfix', 'FixAbs.s'))).isFile(),
    'the tree names the library function',
  );
});

test('init with no built signature file: W_SIGNATURES_ABSENT, a warning, and the project is written; --no-signatures: enabled = false', async () => {
  const dir = await gameDir();
  const out = await runWith(dir, ['init', 'game.gba', '--json'], NO_SIGNATURES);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const absent = lines(out.stdout).find((l) => l['code'] === 'W_SIGNATURES_ABSENT');
  assert.equal(absent?.['severity'], 'warning');
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  assert.match(toml, /\[signatures\]\nenabled = true\n\n/);
  assert.doesNotMatch(toml, /from = /);
  const off = await gameDir();
  const quiet = await runWith(off, ['init', 'game.gba', '--no-signatures', '--json'], WITH_LIBFIX);
  assert.equal(quiet.code, ExitCode.ok, quiet.stdout);
  assert.ok(
    !lines(quiet.stdout).some((l) => typeof l['code'] === 'string' && String(l['code']).startsWith('W_SIGNATURE')),
  );
  const offToml = await readFile(path.join(off, 'romlift.toml'), 'utf8');
  assert.match(offToml, /\[signatures\]\nenabled = false\n/);
  assert.doesNotMatch(offToml, /from = /);
  const help = await run(off, ['init', '--help']);
  assert.match(help.stdout, /--no-signatures/);
});
