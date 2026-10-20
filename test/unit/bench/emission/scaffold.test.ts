// bench/src/scaffold.ts on committed fixtures: the discover model is built once per analysis; the readable
// printer's statistics and tree digest; each printer's tree, applied into an empty directory as a fresh
// project and linked, reproduces the fixture's SHA-1, and a ROM whose bytes differ does not; and the whole
// scaffold step, where every agreeing function is compared (here against an objects directory that defines
// none of them, so no objdiff-cli runs and each is a missing symbol). Linking skips as unavailable only
// without binutils. Phase 4's init build with a fake process runner: init, the agbcc copy, setup.sh and make in
// order, each step only after the one before succeeded, the built ROM's SHA-1, the withheld detail of a sealed ROM;
// the agbcc cache built once from the pin and reused while current; the CLI script setup.sh runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { discover, emitTree, parseElf, profileById, romFromBytes, type Rom } from 'romlift';
import { findBinutils } from 'romlift/node';

import type { BenchContext } from '../../../../bench/src/context.ts';
import { CLI_MAIN } from '../../../../bench/src/large-rom-bin.ts';
import type { ProcessOptions, ProcessResult } from '../../../../bench/src/process.ts';
import { readableStats, treePass } from '../../../../bench/src/readability.ts';
import {
  AGBCC_CACHE_PIN,
  agbccCache,
  agbccCacheCurrent,
  agbccCachePath,
  agbccSource,
  discoverModel,
  initBuild,
  initVerdict,
  NOT_RUN,
  readAgbccPin,
  ROMLIFT_FAMILIES,
  scaffoldTree,
  sourceCli,
  sourceCliScript,
  type CommandRunner,
} from '../../../../bench/src/scaffold.ts';
import { agreeingFunctions } from '../../../../bench/src/score.ts';
import { elfTruth } from '../../../../bench/src/truth.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../../helpers/fixtures.ts';
import { withTempDir } from '../fixtures.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

const fixture = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (fixture === undefined) throw new Error('no far-jump fixture');
const rom = readFixtureRom(fixture);
const analysis = discover(rom, { profile });

test('the discover model is built once per analysis', () => {
  assert.equal(discoverModel(rom, analysis), discoverModel(rom, analysis));
});

test("readability: the readable printer's statistics and the readable stream's digest", () => {
  const model = discoverModel(rom, analysis);
  assert.deepEqual(ROMLIFT_FAMILIES.readability(rom, analysis), {
    stats: readableStats(rom, model),
    treeDigest: treePass(emitTree(rom, model, { decomp: { defined: [] } })).treeDigest,
  });
});

test('each printer: the tree applied into an empty directory links to the SHA-1', { skip }, async () => {
  const model = discoverModel(rom, analysis);
  for (const printer of ['raw', 'readable'] as const) {
    await withTempDir(`romlift-scaffold-${printer}-`, async (dir) => {
      const outcome = await scaffoldTree(rom, model, printer, dir);
      assert.ok(outcome.ok, outcome.detail);
      assert.equal(outcome.sha1, rom.sha1);
      assert.equal(outcome.treeDigest, treePass(emitTree(rom, model, { decomp: { defined: [] }, printer })).treeDigest);
      // Written as a fresh project: the manifest, no journal left behind.
      assert.ok((await readdir(`${dir}/.romlift`)).includes('manifest.json'));
    });
  }
});

test('a ROM whose bytes differ from the tree does not link to its SHA-1', { skip }, async () => {
  const bytes = rom.bytes.slice();
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
  const other: Rom = romFromBytes(bytes, 'e'.repeat(40));
  await withTempDir('romlift-scaffold-differs-', async (dir) => {
    const outcome = await scaffoldTree(other, discoverModel(rom, analysis), 'readable', dir);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.sha1, rom.sha1, 'the tree still links to what it prints');
  });
});

test('the scaffold step: both links, then every agreeing function compared', { skip }, async () => {
  const elf = parseElf(new Uint8Array(readFileSync(fixture.elf)));
  assert.ok(elf.ok);
  const truth = elfTruth(elf.value, rom.bytes.length);
  const agreeing = agreeingFunctions(
    analysis.functions.map((f) => ({ entry: f.entry, end: f.extent.end })),
    truth,
    analysis.startup.span.end,
  );
  assert.ok(agreeing.length > 0);
  await withTempDir('romlift-scaffold-objects-', async (objectsDir) => {
    const run = await ROMLIFT_FAMILIES.scaffold({ rom, analysis, truth, symbols: elf.value.symbols, objectsDir, objdiff: '/nonexistent/objdiff-cli' });
    assert.ok(run.raw.ok && run.readable.ok, `${run.raw.detail} / ${run.readable.detail}`);
    assert.deepEqual(run.objdiff.linked, true);
    assert.equal(run.objdiff.scored, agreeing.length);
    assert.deepEqual(run.objdiff.differences, { 'missing-symbol': agreeing.length });
    assert.deepEqual(Object.keys(run.timings), ['rawLinkMs', 'readableLinkMs', 'objdiffMs']);
  });
});

// ---------------------------------------------------------------- the init build (phase 4)

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: ProcessOptions;
}

const ok = (stdout = ''): ProcessResult => ({ code: 0, stdout, stderr: '' });

/**
 * A fake user build: `init` writes the project's sha1 file, setup.sh checks tools/agbcc was copied in, make writes
 * `built` as the ROM. Any step can be made to fail.
 */
function fakeBuild(calls: Call[], built: Uint8Array, fail: { readonly step?: string; readonly code?: number } = {}): CommandRunner {
  return async (command, args, options) => {
    calls.push({ command, args, options });
    const cwd = options.cwd ?? '';
    const step = command === 'make' ? 'make' : command === './setup.sh' ? 'setup' : args[0] === 'init' ? 'init' : command;
    if (fail.step === step) return { code: fail.code ?? 1, stdout: `${step} output\n`, stderr: `${step} failed at 0x0906A56C\n` };
    if (step === 'init') await writeFile(join(cwd, 'far-jump.sha1'), `${rom.sha1}  far-jump.gba\n`);
    if (step === 'setup') await stat(join(cwd, 'tools', 'agbcc', 'bin', 'agbcc'));
    if (step === 'make') await writeFile(join(cwd, 'far-jump.gba'), built);
    return ok('{"type":"summary","ok":true,"exitCode":0}\n');
  };
}

async function agbccDir(root: string): Promise<string> {
  const dir = join(root, 'agbcc-cache');
  await mkdir(join(dir, 'bin'), { recursive: true });
  await writeFile(join(dir, 'bin', 'agbcc'), '');
  return dir;
}

test('initBuild: the ROM as baserom.gba, init, the agbcc copy, setup.sh and make with ROMLIFT_CLI, then the SHA-1', async () => {
  await withTempDir('romlift-init-build-', async (root) => {
    const project = join(root, 'project');
    await mkdir(project);
    const calls: Call[] = [];
    const build = await initBuild(rom, project, false, { run: fakeBuild(calls, rom.bytes), agbcc: await agbccDir(root), cli: '/bin/romlift' });
    assert.deepEqual(initVerdict(build), { initExit: 0, setupExit: 0, makeExit: 0, sha1Match: true });
    assert.equal(build.detail, 'SHA-1 match');
    assert.ok(build.seconds >= 0);
    assert.deepEqual(calls.map((c) => [c.command, ...c.args]), [['/bin/romlift', 'init', 'baserom.gba', '--json'], ['./setup.sh'], ['make']]);
    assert.ok(calls.every((c) => c.options.cwd === project));
    assert.deepEqual(calls.slice(1).map((c) => c.options.env), [{ ROMLIFT_CLI: '/bin/romlift' }, { ROMLIFT_CLI: '/bin/romlift' }]);
    assert.deepEqual(new Uint8Array(await readFile(join(project, 'baserom.gba'))), rom.bytes);
  });
});

test('initBuild: a built ROM with other bytes is no match, though make exited 0', async () => {
  await withTempDir('romlift-init-build-differs-', async (root) => {
    const project = join(root, 'project');
    await mkdir(project);
    const other = rom.bytes.slice();
    other[0] = (other[0] ?? 0) ^ 0xff;
    const build = await initBuild(rom, project, false, { run: fakeBuild([], other), agbcc: await agbccDir(root), cli: '/bin/romlift' });
    assert.deepEqual(initVerdict(build), { initExit: 0, setupExit: 0, makeExit: 0, sha1Match: false });
    assert.match(build.detail, /far-jump\.gba does not have SHA-1 [0-9a-f]{40}$/);
  });
});

test('initBuild: a failed step stops the build, the later ones are NOT_RUN, and a sealed ROM keeps no output', async () => {
  for (const [step, expected] of [
    ['init', { initExit: 3, setupExit: NOT_RUN, makeExit: NOT_RUN, sha1Match: false }],
    ['setup', { initExit: 0, setupExit: 3, makeExit: NOT_RUN, sha1Match: false }],
    ['make', { initExit: 0, setupExit: 0, makeExit: 3, sha1Match: false }],
  ] as const) {
    for (const withhold of [false, true]) {
      await withTempDir('romlift-init-build-fail-', async (root) => {
        const project = join(root, 'project');
        await mkdir(project);
        const calls: Call[] = [];
        const build = await initBuild(rom, project, withhold, { run: fakeBuild(calls, rom.bytes, { step, code: 3 }), agbcc: await agbccDir(root), cli: '/bin/romlift' });
        assert.deepEqual(initVerdict(build), expected, `${step}, withhold ${withhold}`);
        assert.equal(calls.length, step === 'init' ? 1 : step === 'setup' ? 2 : 3);
        if (withhold) {
          assert.match(build.detail, /exited 3 \(output withheld: sealed\)$/);
          assert.ok(!build.detail.includes('0x0906A56C'));
        } else assert.match(build.detail, new RegExp(`exited 3:\\n${step} output\\n${step} failed at 0x0906A56C$`));
      });
    }
  }
});

test('the CLI script quotes its words and runs the source CLI with the launcher options', async () => {
  assert.equal(sourceCliScript('/n o/node', ['--max-old-space-size=1024'], "/it's/main.ts"), `#!/bin/sh\nexec '/n o/node' '--conditions=source' '--max-old-space-size=1024' '/it'\\''s/main.ts' "$@"\n`);
  await withTempDir('romlift-source-cli-', async (dir) => {
    const cli = await sourceCli(dir);
    assert.equal((await readFile(cli, 'utf8')).split('\n')[1], `exec '${process.execPath}' '--conditions=source' '--max-old-space-size=1024' '${CLI_MAIN}' "$@"`);
    const ran = spawnSync(cli, [], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /^Usage: romlift <command>/);
  });
});

// ---------------------------------------------------------------- the agbcc cache

const PIN = { url: 'https://github.com/pret/agbcc', commit: 'da598c1d918402c42c0c0d7128ba14567f3175e9' } as const;

async function cacheTier(root: string): Promise<BenchContext> {
  const repoRoot = join(root, 'repo');
  await mkdir(join(repoRoot, 'templates'), { recursive: true });
  await writeFile(join(repoRoot, 'templates', 'agbcc.json'), `${JSON.stringify(PIN)}\n`);
  return { repoRoot, benchRoot: join(root, 'bench'), pocRoot: join(root, 'poc') };
}

/** pret/agbcc's scripts faked: install.sh lays out <root>/tools/agbcc as the real one does; a fetch by commit can fail. */
function fakeAgbcc(calls: Call[], options: { readonly shallowFails?: boolean; readonly buildFails?: boolean } = {}): CommandRunner {
  return async (command, args, opts) => {
    calls.push({ command, args, options: opts });
    if (command === 'git' && args[1] === '-q' && args[2] === '--depth' && options.shallowFails === true) return { code: 128, stdout: '', stderr: 'not our ref' };
    if (command === './build.sh' && options.buildFails === true) return { code: 2, stdout: '', stderr: 'gcc: error' };
    if (command === './install.sh') {
      const dir = join(args[0] ?? '', 'tools', 'agbcc');
      for (const sub of ['bin', 'include', 'lib']) await mkdir(join(dir, sub), { recursive: true });
      for (const bin of ['agbcc', 'old_agbcc', 'agbcc_arm']) await writeFile(join(dir, 'bin', bin), bin);
    }
    return ok();
  };
}

test('readAgbccPin reads templates/agbcc.json; the repository pins pret/agbcc', async () => {
  const pin = await readAgbccPin({ repoRoot: join(import.meta.dirname, '..', '..', '..', '..'), benchRoot: '', pocRoot: '' });
  assert.equal(pin.url, PIN.url);
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
  await withTempDir('romlift-agbcc-pin-', async (root) => {
    const cx = await cacheTier(root);
    await writeFile(join(cx.repoRoot, 'templates', 'agbcc.json'), '{"url":"x"}');
    await assert.rejects(readAgbccPin(cx), /agbcc\.json: commit is not forty/);
  });
});

test('agbccCache builds once from the pin, then reuses the cache while its pin is current', async () => {
  await withTempDir('romlift-agbcc-cache-', async (root) => {
    const cx = await cacheTier(root);
    const calls: Call[] = [];
    const lines: string[] = [];
    const deps = { run: fakeAgbcc(calls, { shallowFails: true }), env: {}, log: (l: string) => lines.push(l) };
    const cache = await agbccCache(cx, deps);
    assert.equal(cache, agbccCachePath(cx));
    assert.equal(cache, join(cx.repoRoot, 'bench', '.local', 'agbcc'));
    assert.deepEqual((await readdir(join(cache, 'bin'))).sort(), ['agbcc', 'agbcc_arm', 'old_agbcc']);
    assert.equal(await readFile(join(cache, AGBCC_CACHE_PIN), 'utf8'), `${JSON.stringify(PIN)}\n`);
    assert.ok(await agbccCacheCurrent(cache, PIN));
    assert.deepEqual(
      calls.map((c) => [c.command, ...c.args.map((a) => (a.startsWith(root) || a.startsWith('/') ? '<path>' : a))]),
      [
        ['git', 'init', '-q'],
        ['git', 'fetch', '-q', '--depth', '1', PIN.url, PIN.commit],
        ['git', 'fetch', '-q', PIN.url],
        ['git', 'checkout', '-q', PIN.commit],
        ['./build.sh'],
        ['./install.sh', '<path>'],
      ],
    );
    assert.equal(lines.length, 1);
    // Current: nothing runs.
    calls.length = 0;
    assert.equal(await agbccCache(cx, deps), cache);
    assert.equal(calls.length, 0);
    // Another pin rebuilds it.
    await writeFile(join(cx.repoRoot, 'templates', 'agbcc.json'), JSON.stringify({ ...PIN, commit: 'a'.repeat(40) }));
    assert.equal(await agbccCacheCurrent(cache, { ...PIN, commit: 'a'.repeat(40) }), false);
    await agbccCache(cx, deps);
    assert.ok(calls.some((c) => c.command === './build.sh'));
    assert.ok(await agbccCacheCurrent(cache, { ...PIN, commit: 'a'.repeat(40) }));
  });
});

test('agbccCache: a failing build throws with its output and leaves no cache', async () => {
  await withTempDir('romlift-agbcc-cache-fail-', async (root) => {
    const cx = await cacheTier(root);
    await assert.rejects(agbccCache(cx, { run: fakeAgbcc([], { buildFails: true }), env: {}, log: () => {} }), /agbcc: build\.sh exited 2:\ngcc: error/);
    assert.equal(await agbccCacheCurrent(agbccCachePath(cx), PIN), false);
  });
});

test('agbccSource: AGBCC_URL, else the benchmark root\'s agbcc checkout holding the commit, else the pin', async () => {
  await withTempDir('romlift-agbcc-source-', async (root) => {
    const cx = await cacheTier(root);
    const holds = (code: number): CommandRunner => async () => ({ code, stdout: '', stderr: '' });
    assert.equal(await agbccSource(cx, PIN, { run: holds(0), env: { AGBCC_URL: '/mirror' } }), '/mirror');
    assert.equal(await agbccSource(cx, PIN, { run: holds(0), env: {} }), PIN.url, 'no checkout');
    await mkdir(join(cx.benchRoot, 'agbcc', '.git'), { recursive: true });
    assert.equal(await agbccSource(cx, PIN, { run: holds(0), env: {} }), join(cx.benchRoot, 'agbcc'));
    assert.equal(await agbccSource(cx, PIN, { run: holds(1), env: {} }), PIN.url, 'the checkout lacks the commit');
  });
});
