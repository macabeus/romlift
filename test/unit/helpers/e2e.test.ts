// The end-to-end harness (test/helpers/e2e.ts) with fake commands: shell scripts stand in for romlift, setup.sh,
// make and node, so these tests need no ROM and no toolchain. They show the source-CLI shim passing its arguments
// through, the project that holds only its ROM, the --json summary check, the .sha1 reader, the tree snapshot and
// diff, the agbcc cache copying one build into later projects, the time limit, and the whole init, setup.sh and
// make loop with each way it can fail.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';

import {
  type CommandRunner,
  NOT_BUILT,
  NOT_STARTED_CODE,
  REPO_ROOT,
  TIMED_OUT_CODE,
  agbccCache,
  buildProject,
  diffTrees,
  endToEndFixtures,
  initArgsOf,
  parseNdjson,
  parseSha1Text,
  readSha1File,
  runCommand,
  runEndToEnd,
  runRomlift,
  sameBytes,
  sha1Hex,
  shellQuote,
  snapshotTree,
  sourceCliText,
  summaryProblem,
  tempProject,
  writeSourceCli,
} from '../../helpers/e2e.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';

const ROM = new Uint8Array([0x2e, 0x00, 0x00, 0xea, 0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21]);
const ROM_SHA1 = sha1Hex(ROM);

async function scratch(t: TestContext, prefix = 'romlift-e2e-test-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function script(file: string, body: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

/** A runner that runs `make` as the fake script `make` names, and everything else as given. */
function withFakeMake(make: string): CommandRunner {
  return (command, args, options) => runCommand(command === 'make' ? make : command, args, options);
}

test('runCommand closes stdin, drops NODE_TEST_CONTEXT, and reports a failed start and a time limit by code', async (t) => {
  const dir = await scratch(t);
  const cat = await runCommand('cat', [], { timeoutMs: 10_000 });
  assert.equal(cat.code, 0, 'cat reads an empty stdin and ends');
  assert.equal(cat.stdout, '');
  const env = await runCommand(
    await script(path.join(dir, 'env.sh'), 'printf "%s|%s" "${NODE_TEST_CONTEXT:-unset}" "$EXTRA"'),
    [],
    { env: { EXTRA: 'given' } },
  );
  assert.equal(env.stdout, 'unset|given');
  const missing = await runCommand(path.join(dir, 'no-such-command'), []);
  assert.equal(missing.code, NOT_STARTED_CODE);
  const slow = await runCommand(await script(path.join(dir, 'slow.sh'), 'sleep 30'), [], { timeoutMs: 200 });
  assert.equal(slow.code, TIMED_OUT_CODE);
  assert.equal(slow.timedOut, true);
  const failed = await runCommand(await script(path.join(dir, 'exit3.sh'), 'echo out; echo err >&2; exit 3'), []);
  assert.deepEqual([failed.code, failed.stdout, failed.stderr, failed.timedOut], [3, 'out\n', 'err\n', false]);
});

test('the source-CLI shim runs node --conditions=source src/cli/main.ts with every argument as given', async (t) => {
  const dir = await scratch(t, "romlift e2e 'quoted' ");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  const text = sourceCliText({ node: '/opt/node', repoRoot: '/repo' });
  assert.equal(text, `#!/bin/sh\nexec '/opt/node' '--conditions=source' '/repo/src/cli/main.ts' "$@"\n`);
  assert.match(
    sourceCliText({ node: '/opt/node', repoRoot: '/repo', maxOldSpaceMiB: 1024 }),
    /^exec '\/opt\/node' '--conditions=source' '--max-old-space-size=1024' /m,
  );
  assert.match(
    sourceCliText(),
    new RegExp(`${path.join(REPO_ROOT, 'src', 'cli', 'main.ts').replaceAll('/', '\\/').replaceAll('.', '\\.')}`),
  );

  const node = await script(path.join(dir, 'fake node'), 'for a in "$@"; do printf "[%s]" "$a"; done');
  const shim = await writeSourceCli(path.join(dir, 'bin'), { node, repoRoot: path.join(dir, 'repo') });
  assert.equal(path.basename(shim), 'romlift');
  const run = await runCommand(shim, ['init', 'a rom.gba', '--json']);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(
    run.stdout,
    `[--conditions=source][${path.join(dir, 'repo', 'src', 'cli', 'main.ts')}][init][a rom.gba][--json]`,
  );
});

test('tempProject makes a directory that holds only the ROM, from a path or from bytes', async (t) => {
  const parent = await scratch(t);
  const source = path.join(parent, 'source', 'game.gba');
  await mkdir(path.dirname(source));
  await writeFile(source, ROM);
  const fromPath = await tempProject(source, { parent });
  assert.deepEqual(await readdir(fromPath.dir), ['game.gba']);
  assert.equal(fromPath.romFile, 'game.gba');
  assert.equal(fromPath.sha1, ROM_SHA1);
  const fromBytes = await tempProject(ROM, { parent });
  assert.deepEqual(await readdir(fromBytes.dir), ['baserom.gba']);
  assert.notEqual(fromBytes.dir, fromPath.dir);
  const named = await tempProject(ROM, { parent, romFile: 'composite.gba' });
  assert.deepEqual(await readdir(named.dir), ['composite.gba']);
  await named.remove();
  assert.equal((await readdir(parent)).includes(path.basename(named.dir)), false);
  await assert.rejects(tempProject(ROM, { parent, romFile: 'sub/rom.gba' }), /not a plain ROM file name/);
  await assert.rejects(tempProject(ROM, { parent, romFile: '.rom.gba' }), /not a plain ROM file name/);
});

test('parseNdjson and summaryProblem: the last line is the summary whose exitCode is the process exit code', () => {
  const good = parseNdjson(
    '{"type":"diagnostic","code":"W_X","severity":"warning","message":"m"}\n\n{"type":"summary","ok":true,"exitCode":0}\n',
  );
  assert.ok(good.ok);
  assert.equal(good.lines.length, 2);
  assert.equal(summaryProblem(good.lines, 0), undefined);
  assert.match(summaryProblem(good.lines, 1) ?? '', /exitCode 0, the process exited 1/);
  assert.match(summaryProblem([{ type: 'summary', ok: true, exitCode: 1 }], 1) ?? '', /ok true with exit 1/);
  assert.match(summaryProblem([{ type: 'check', ok: true }], 0) ?? '', /not the summary/);
  assert.match(summaryProblem([], 0) ?? '', /no output line/);
  const bad = parseNdjson('{"type":"summary"}\nnot json\n');
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? '' : bad.error, /^line 2 is not JSON/);
  const untyped = parseNdjson('[1,2]\n');
  assert.match(untyped.ok ? '' : untyped.error, /^line 1 is not an object with a string type/);
});

test('runRomlift appends --json, parses the NDJSON, lists the diagnostic codes and names a broken contract', async (t) => {
  const dir = await scratch(t);
  const cli = await script(
    path.join(dir, 'romlift'),
    [
      'last=""; for a in "$@"; do last="$a"; done',
      '[ "$last" = "--json" ] || { echo "no --json" >&2; exit 2; }',
      'case "$1" in',
      '  ok) echo \'{"type":"summary","ok":true,"exitCode":0}\' ;;',
      '  refuse) echo \'{"type":"diagnostic","code":"E_MODULE_BORDER","severity":"error","message":"m"}\'; echo \'{"type":"summary","ok":false,"exitCode":1}\'; exit 1 ;;',
      '  lie) echo \'{"type":"summary","ok":true,"exitCode":0}\'; exit 1 ;;',
      '  garble) echo \'{"type":\'; exit 0 ;;',
      'esac',
    ].join('\n'),
  );
  const ok = await runRomlift(cli, ['ok'], { cwd: dir });
  assert.deepEqual([ok.result.code, ok.problem, ok.summary?.exitCode, ok.codes], [0, undefined, 0, []]);
  const refused = await runRomlift(cli, ['refuse']);
  assert.deepEqual([refused.result.code, refused.problem, refused.codes], [1, undefined, ['E_MODULE_BORDER']]);
  const lie = await runRomlift(cli, ['lie']);
  assert.match(lie.problem ?? '', /^romlift lie --json: the summary says exitCode 0, the process exited 1/);
  const garbled = await runRomlift(cli, ['garble']);
  assert.match(garbled.problem ?? '', /printed bad NDJSON: line 1 is not JSON/);
  assert.equal(garbled.summary, undefined);
  let seen: readonly string[] = [];
  const recording: CommandRunner = async (_command, args) => {
    seen = args;
    return { code: 0, stdout: '{"type":"summary","ok":true,"exitCode":0}\n', stderr: '', timedOut: false };
  };
  await runRomlift('romlift', ['generate', '--dry-run'], { runner: recording });
  assert.deepEqual(seen, ['generate', '--dry-run', '--json']);
});

test('parseSha1Text and readSha1File read the one <name>.sha1 in sha1sum format', async (t) => {
  assert.deepEqual(parseSha1Text(`${ROM_SHA1}  game.gba\n`), { sha1: ROM_SHA1, file: 'game.gba' });
  assert.deepEqual(parseSha1Text(`${ROM_SHA1} *game.gba`), { sha1: ROM_SHA1, file: 'game.gba' });
  assert.equal(parseSha1Text(`${ROM_SHA1.toUpperCase()}  game.gba`), undefined);
  assert.equal(parseSha1Text(`${ROM_SHA1}game.gba`), undefined);
  assert.equal(parseSha1Text(''), undefined);
  const dir = await scratch(t);
  assert.match((await readSha1File(dir)).ok ? '' : 'none', /none/);
  await writeFile(path.join(dir, 'game.sha1'), `${ROM_SHA1}  game.gba\n`);
  assert.deepEqual(await readSha1File(dir), {
    ok: true,
    path: path.join(dir, 'game.sha1'),
    sha1: ROM_SHA1,
    file: 'game.gba',
  });
  await writeFile(path.join(dir, 'other.sha1'), 'x');
  const two = await readSha1File(dir);
  assert.match(two.ok ? '' : two.problem, /^2 \.sha1 files/);
  await rm(path.join(dir, 'game.sha1'));
  const bad = await readSha1File(dir);
  assert.match(bad.ok ? '' : bad.problem, /other\.sha1 is not in sha1sum format/);
});

test('snapshotTree and diffTrees: added, removed, changed and touched files, in code-unit order, without .git', async (t) => {
  const dir = await scratch(t);
  await mkdir(path.join(dir, 'asm', 'nonmatchings'), { recursive: true });
  await mkdir(path.join(dir, '.git'));
  await writeFile(path.join(dir, '.git', 'HEAD'), 'ref');
  await writeFile(path.join(dir, 'b.txt'), 'b');
  await writeFile(path.join(dir, 'C.txt'), 'C');
  await writeFile(path.join(dir, 'asm', 'nonmatchings', 'f.s'), 'f');
  await writeFile(path.join(dir, 'gone.txt'), 'gone');
  await writeFile(path.join(dir, 'same.txt'), 'same');
  const before = await snapshotTree(dir);
  assert.deepEqual([...before.keys()], ['C.txt', 'asm/nonmatchings/f.s', 'b.txt', 'gone.txt', 'same.txt']);
  assert.equal(before.get('b.txt')?.sha1, sha1Hex(new TextEncoder().encode('b')));
  assert.equal(before.get('b.txt')?.size, 1);
  assert.deepEqual(diffTrees(before, before), { added: [], removed: [], changed: [], touched: [] });

  await writeFile(path.join(dir, 'b.txt'), 'b2');
  await rm(path.join(dir, 'gone.txt'));
  await writeFile(path.join(dir, 'new.txt'), 'new');
  await writeFile(path.join(dir, 'same.txt'), 'same');
  const later = new Date(Date.UTC(2030, 0, 1));
  await utimes(path.join(dir, 'same.txt'), later, later);
  const after = await snapshotTree(dir);
  const diff = diffTrees(before, after);
  assert.deepEqual(diff, { added: ['new.txt'], removed: ['gone.txt'], changed: ['b.txt'], touched: ['same.txt'] });
  assert.equal(sameBytes(diff), false);
  assert.equal(sameBytes({ added: [], removed: [], changed: [], touched: ['same.txt'] }), true);
  assert.deepEqual(
    [...(await snapshotTree(dir, { exclude: ['asm', '.git', 'C.txt'] })).keys()],
    ['b.txt', 'new.txt', 'same.txt'],
  );
});

test('agbccCache fills once, from a prebuilt directory or the first project, and copies the installed parts into later projects', async (t) => {
  const dir = await scratch(t);
  const prebuilt = path.join(dir, 'prebuilt');
  await script(path.join(prebuilt, 'bin', 'agbcc'), 'echo agbcc');
  await script(path.join(prebuilt, 'bin', 'old_agbcc'), 'echo old_agbcc');
  await writeFile(path.join(prebuilt, 'build.sh'), 'the checkout, not copied');
  const cache = await agbccCache(path.join(dir, 'cache'), prebuilt);
  assert.equal(await cache.filled(), true);
  const project = path.join(dir, 'p1');
  await mkdir(project);
  assert.equal(await cache.provide(project), true);
  assert.deepEqual((await readdir(path.join(project, 'tools', 'agbcc'))).sort(), ['bin']);
  assert.equal(
    (await runCommand(path.join(project, 'tools', 'agbcc', 'bin', 'old_agbcc'), [])).stdout,
    'old_agbcc\n',
    'still executable',
  );
  assert.equal(await cache.provide(project), false, 'a project that has agbcc keeps its own');
  await assert.rejects(
    agbccCache(path.join(dir, 'other'), path.join(dir, 'empty')),
    /no bin\/agbcc under the prebuilt agbcc/,
  );
  const stale = path.join(dir, 'stale');
  await script(path.join(stale, 'bin', 'agbcc'), 'echo agbcc');
  await writeFile(
    path.join(stale, 'romlift-agbcc-pin.json'),
    `${JSON.stringify({ url: 'https://example.invalid/agbcc', commit: '0'.repeat(40) })}\n`,
  );
  await assert.rejects(
    agbccCache(path.join(dir, 'other2'), stale),
    /was built at .*, not at templates\/agbcc\.json's/,
    'a prebuilt agbcc of another pin is refused (architecture-11)',
  );

  const empty = await agbccCache(path.join(dir, 'cache2'));
  const first = path.join(dir, 'first');
  const second = path.join(dir, 'second');
  await mkdir(second);
  assert.equal(await empty.provide(second), false, 'nothing to copy yet');
  assert.equal(await empty.remember(first), false, 'the first project built nothing yet');
  await script(path.join(first, 'tools', 'agbcc', 'bin', 'agbcc'), 'echo built');
  await mkdir(path.join(first, 'tools', 'agbcc', 'include'));
  await writeFile(path.join(first, 'tools', 'agbcc', 'include', 'stdio.h'), '');
  assert.equal(await empty.remember(first), true);
  assert.equal(await empty.remember(first), false, 'filled once');
  assert.equal(await empty.provide(second), true);
  assert.deepEqual((await readdir(path.join(second, 'tools', 'agbcc'))).sort(), ['bin', 'include']);
});

/** A project after a fake init: a fake setup.sh that requires ROMLIFT_CLI and agbcc, and the .sha1 of `rom`. */
async function fakeProject(dir: string, rom: Uint8Array, built = 'game.gba'): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'baserom.gba'), rom);
  await writeFile(path.join(dir, 'game.sha1'), `${sha1Hex(rom)}  ${built}\n`);
  await script(
    path.join(dir, 'setup.sh'),
    '[ -n "$ROMLIFT_CLI" ] || exit 9\n[ -x tools/agbcc/bin/agbcc ] || exit 8\necho ready',
  );
}

test('buildProject runs setup.sh and make under their limits with ROMLIFT_CLI set, and checks the built ROM against <name>.sha1', async (t) => {
  const dir = await scratch(t);
  const cache = await agbccCache(path.join(dir, 'cache'));
  await script(path.join(dir, 'seed', 'tools', 'agbcc', 'bin', 'agbcc'), 'true');
  await cache.remember(path.join(dir, 'seed'));
  const copyMake = withFakeMake(await script(path.join(dir, 'make-copy'), 'cp baserom.gba game.gba'));

  const ok = path.join(dir, 'ok');
  await fakeProject(ok, ROM);
  const built = await buildProject(ok, { cli: '/fake/romlift', agbcc: cache, runner: copyMake }, ROM_SHA1);
  assert.equal(built.failure, undefined);
  assert.deepEqual(
    [built.recorded, built.built, built.setup?.stdout],
    [{ sha1: ROM_SHA1, file: 'game.gba' }, ROM_SHA1, 'ready\n'],
  );

  const noAgbcc = path.join(dir, 'no-agbcc');
  await fakeProject(noAgbcc, ROM);
  const refused = await buildProject(noAgbcc, { cli: '/fake/romlift', runner: copyMake });
  assert.match(refused.failure ?? '', /^\.\/setup\.sh exited 8/);
  assert.equal(refused.make, undefined, 'make does not run after a failed setup.sh');

  const slow = path.join(dir, 'slow');
  await fakeProject(slow, ROM);
  const timed = await buildProject(slow, {
    cli: '/fake/romlift',
    agbcc: cache,
    runner: withFakeMake(await script(path.join(dir, 'make-slow'), 'sleep 30')),
    makeTimeoutMs: 200,
  });
  assert.match(timed.failure ?? '', /^make timed out/);

  const wrong = path.join(dir, 'wrong');
  await fakeProject(wrong, ROM);
  const flipped = withFakeMake(await script(path.join(dir, 'make-wrong'), 'printf x > game.gba'));
  assert.match(
    (await buildProject(wrong, { cli: 'c', agbcc: cache, runner: flipped })).failure ?? '',
    /^make built game\.gba with SHA-1 [0-9a-f]{40}, game\.sha1 records /,
  );
  assert.match(
    (await buildProject(wrong, { cli: 'c', agbcc: cache, runner: copyMake }, '0'.repeat(40))).failure ?? '',
    /^game\.sha1 records [0-9a-f]{40}, the ROM is 0{40}/,
  );
  const nothing = withFakeMake(await script(path.join(dir, 'make-nothing'), 'true'));
  const absent = path.join(dir, 'absent');
  await fakeProject(absent, ROM, 'never.gba');
  assert.match(
    (await buildProject(absent, { cli: 'c', agbcc: cache, runner: nothing })).failure ?? '',
    /^make did not build never\.gba/,
  );
});

/** A fake romlift whose init writes a fake project for the ROM it is given, or refuses when the ROM is named refuse.gba. */
async function fakeCli(dir: string): Promise<string> {
  return script(
    path.join(dir, 'bin', 'romlift'),
    [
      '[ "$1" = init ] || exit 2',
      'if [ "$2" = refuse.gba ]; then echo \'{"type":"diagnostic","code":"E_ROM_NOT_GBA","severity":"error","message":"m"}\'; echo \'{"type":"summary","ok":false,"exitCode":1}\'; exit 1; fi',
      'cp "$2" baserom.gba',
      'if command -v sha1sum >/dev/null 2>&1; then sum=$(sha1sum baserom.gba); else sum=$(shasum -a 1 baserom.gba); fi',
      'printf "%s  game.gba\\n" "${sum%% *}" > game.sha1',
      'printf "schema = 1\\n# %s\\n" "$*" > romlift.toml',
      'printf "#!/bin/sh\\necho ready\\n" > setup.sh; chmod +x setup.sh',
      'echo \'{"type":"summary","ok":true,"exitCode":0}\'',
    ].join('\n'),
  );
}

test('runEndToEnd: init in a directory holding only the ROM, then setup.sh and make to the SHA-1, with romlift.toml untouched', async (t) => {
  const dir = await scratch(t);
  const cli = await fakeCli(dir);
  const make = withFakeMake(
    await script(path.join(dir, 'make-copy'), 'mkdir -p build; echo o > build/x.o; cp baserom.gba game.gba'),
  );
  const project = await tempProject(ROM, { parent: dir, romFile: 'composite.gba' });
  const outcome = await runEndToEnd(project, { cli, runner: make, initArgs: ['--module-size', '0x200'] });
  assert.equal(outcome.failure, undefined);
  assert.equal(outcome.build?.built, ROM_SHA1);
  assert.match(
    await readFile(path.join(project.dir, 'romlift.toml'), 'utf8'),
    /^# init composite\.gba --module-size 0x200 --json$/m,
    'init got its arguments, then --json',
  );
  assert.deepEqual(
    outcome.diff,
    { added: ['game.gba'], removed: [], changed: [], touched: [] },
    'build/ is left out of the diff',
  );
  assert.deepEqual(
    [...(outcome.afterInit?.keys() ?? [])],
    ['baserom.gba', 'composite.gba', 'game.sha1', 'romlift.toml', 'setup.sh'],
  );

  const edits = withFakeMake(
    await script(path.join(dir, 'make-edit'), 'cp baserom.gba game.gba; echo "# edited" >> romlift.toml'),
  );
  const edited = await runEndToEnd(await tempProject(ROM, { parent: dir }), { cli, runner: edits });
  assert.equal(edited.failure, 'setup.sh or make changed romlift.toml');
  assert.deepEqual(edited.diff?.changed, ['romlift.toml']);

  const refused = await runEndToEnd(await tempProject(ROM, { parent: dir, romFile: 'refuse.gba' }), {
    cli,
    runner: make,
  });
  assert.match(refused.failure ?? '', /^init exited 1 with \[E_ROM_NOT_GBA\]/);
  assert.equal(refused.build, undefined);
  const broken = await script(path.join(dir, 'broken', 'romlift'), 'echo "not json"');
  const bad = await runEndToEnd(await tempProject(ROM, { parent: dir }), { cli: broken, runner: make });
  assert.match(bad.failure ?? '', /printed bad NDJSON/);
});

test("initArgsOf reads expect.json's init.args, and endToEndFixtures lists every committed fixture but c-data", async () => {
  assert.deepEqual(initArgsOf('{"entries":[]}', 'x'), []);
  assert.deepEqual(initArgsOf('{"init":{"args":["--module-size","0x200"]}}', 'x'), ['--module-size', '0x200']);
  assert.deepEqual(initArgsOf('{"init":{}}', 'x'), []);
  assert.throws(
    () => initArgsOf('{"init":{"args":[1]}}', 'f/expect.json'),
    /f\/expect\.json: init\.args is not an array of strings/,
  );
  assert.throws(() => initArgsOf('{"init":[]}', 'f/expect.json'), /init is not an object/);
  assert.throws(() => initArgsOf('[]', 'f/expect.json'), /not an object/);

  const all = listSyntheticFixtures();
  const built = await endToEndFixtures(all);
  assert.deepEqual(Object.keys(NOT_BUILT), ['c-data']);
  assert.deepEqual(
    built.map((b) => b.fixture.name),
    all.map((f) => f.name).filter((n) => n !== 'c-data'),
  );
  assert.deepEqual(built.find((b) => b.fixture.name === 'composite')?.initArgs, ['--module-size', '0x200']);
  assert.ok(built.some((b) => b.fixture.name === 'multi-compiler'));
});
