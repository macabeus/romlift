// bench/src/large-rom.ts (g3.large-rom): the parent with an injected image and child runner (no 32 MiB ROM, no
// process): the frozen report, KiB to MiB, a child that printed nothing; the config the init child hands the
// generate child; and the child itself, in process, on a committed fixture: init and generate write the same tree.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { configFromDiscover, discover, type Rom, type RomliftConfig } from 'romlift';
import { sha1Of } from 'romlift/node';

import { generateInto, ROMLIFT_EMISSION, type EmissionRunner } from '../../../bench/src/emission-run.ts';
import {
  bothReported,
  CHILD_NODE_ARGS,
  decodeConfig,
  DEFAULT_LARGE_ROM_DEPS,
  encodeConfig,
  LARGE_ROM_MAX_OLD_SPACE_MIB,
  LARGE_ROM_SCHEMA,
  largeRom,
  largeRomText,
  maxOldSpaceOf,
  mib,
  outcomeExitCode,
  parseChildReport,
  romFileDeps,
  runChild,
  runOf,
  type LargeRomDeps,
} from '../../../bench/src/large-rom.ts';
import { peakLiveHeapOf } from '../../../bench/src/live-heap.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');

function ok(stdout: string) {
  return { code: 0, stdout, stderr: '' };
}

test('the parent: the image is written once, init then generate each in a child, the frozen report', async () => {
  const image = Uint8Array.from({ length: 64 }, (_, i) => i);
  const calls: (readonly string[])[] = [];
  const deps: LargeRomDeps = {
    image: async () => image,
    spawn: async (args) => {
      calls.push(args);
      const command = args[1];
      return ok(`progress\n${JSON.stringify({ command, exitCode: 0, maxRssKiB: 300 * 1024 + 512, maxOldSpaceSizeMiB: 384, peakLiveHeapMiB: 250.25, files: 9, detail: 'written', treeDigest: 'ab' })}\n`);
    },
    log: () => {},
  };
  const report = await largeRom(deps);
  assert.deepEqual(Object.keys(report), ['schema', 'romBytes', 'sha1', 'runs']);
  assert.equal(report.schema, LARGE_ROM_SCHEMA);
  assert.equal(report.romBytes, 64);
  assert.equal(report.sha1, sha1Of(image));
  assert.deepEqual(
    report.runs.map((r) => [r.command, r.exitCode, r.maxRssMiB, r.maxOldSpaceSizeMiB, r.peakLiveHeapMiB, r.treeDigest]),
    [
      ['init', 0, 300.5, 384, 250.25, 'ab'],
      ['generate', 0, 300.5, 384, 250.25, 'ab'],
    ],
  );
  assert.deepEqual(
    calls.map((a) => [a[0], a[1], a[2], a[4], a.at(-2)]),
    [
      ['--child', 'init', '--rom', '--out', '--config-out'],
      ['--child', 'generate', '--rom', '--out', '--config'],
    ],
  );
  assert.equal(calls[0]?.at(-1), calls[1]?.at(-1), 'generate reads the config init wrote');
  assert.ok(bothReported(report));
  assert.match(largeRomText(report), /\ninit {5}exit 0 {2}peak RSS 300\.5 MiB \(under \d+ MiB\) {2}peak live heap 250\.3 MiB {2}heap cap 384 MiB {2}tree ab\n/);
});

test('a child that printed no report: its exit code (1 when it exited 0), no RSS, and the tail of its output', async () => {
  const run = runOf('generate', { code: 134, stdout: '', stderr: 'FATAL ERROR: Reached heap limit\n' });
  assert.deepEqual(run, { command: 'generate', exitCode: 134, maxRssMiB: 0, maxOldSpaceSizeMiB: null, detail: 'no report: FATAL ERROR: Reached heap limit' });
  assert.equal(runOf('init', ok('not json')).exitCode, 1);
  const oom = runOf('init', { code: 134, stdout: '', stderr: '<--- Last few GCs --->\nFATAL ERROR: Ineffective mark-compacts near heap limit\n 1: 0x1 node::OOMErrorHandler\n 2: 0x2 start\n' });
  assert.equal(oom.detail, 'no report: FATAL ERROR: Ineffective mark-compacts near heap limit');
  const deps: LargeRomDeps = { image: async () => new Uint8Array(8), spawn: async () => ok(''), log: () => {} };
  assert.ok(!bothReported(await largeRom(deps)));
});

test('parseChildReport reads the last line only, and only a child report', () => {
  assert.equal(parseChildReport('{"command":"init","exitCode":0,"maxRssKiB":1}\nx'), undefined);
  assert.equal(parseChildReport('{"command":"other","exitCode":0,"maxRssKiB":1}'), undefined);
  assert.deepEqual(parseChildReport('noise\n{"command":"init","exitCode":3,"maxRssKiB":2048,"files":1,"detail":"d"}\n')?.exitCode, 3);
  assert.equal(mib(1536), 1.5);
  assert.equal(mib(1000), 0.98);
});

test('the heap cap: the children run under the one the romlift bin passes, and report it (D68 b)', async () => {
  const main = await readFile(new URL('../../../src/cli/main.ts', import.meta.url), 'utf8');
  assert.equal(main.split('\n')[0], `#!/usr/bin/env -S node --max-old-space-size=${LARGE_ROM_MAX_OLD_SPACE_MIB}`);
  assert.equal(maxOldSpaceOf(['--conditions=source', '--max-old-space-size=256']), 256);
  assert.equal(maxOldSpaceOf(['--max_old_space_size=128', '--max-old-space-size=300']), 300);
  assert.equal(maxOldSpaceOf(['--conditions=source', '--max-semi-space-size=16']), null);
  assert.equal(maxOldSpaceOf(CHILD_NODE_ARGS), LARGE_ROM_MAX_OLD_SPACE_MIB);
  let spawned: readonly string[] = [];
  const deps: LargeRomDeps = { ...DEFAULT_LARGE_ROM_DEPS, spawn: async (args) => ((spawned = args), ok('')), log: () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'romlift-large-rom-file-'));
  try {
    const file = join(dir, 'rom.gba');
    await writeFile(file, Uint8Array.from([1, 2, 3, 4]));
    const report = await largeRom(romFileDeps(file, deps));
    assert.equal(report.romBytes, 4);
    assert.equal(report.sha1, sha1Of(Uint8Array.from([1, 2, 3, 4])));
    assert.equal(spawned[1], 'generate');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an outcome maps to the exit code of romlift verify', () => {
  assert.equal(outcomeExitCode({ ok: true, detail: '', files: 1 }), 0);
  assert.equal(outcomeExitCode({ ok: false, failure: 'check', detail: '', files: 1 }), 3);
  assert.equal(outcomeExitCode({ ok: false, failure: 'error', detail: '', files: 1 }), 1);
  assert.equal(outcomeExitCode({ ok: false, failure: 'write', detail: '', files: 1 }), 1);
});

test('the config survives the trip from the init child to the generate child', () => {
  const rom = readFixtureRom(FAR_JUMP);
  const config = configFromDiscover(rom, discover(rom));
  assert.deepEqual(decodeConfig(encodeConfig(config)), config);
  assert.throws(() => decodeConfig('{"schema":2}'), /not schema 1/);
});

/** The fixture's config with its startup module renamed (sidesteps the confirm-mode startup defect, see verify.test.ts). */
function renamedStartup(rom: Rom): RomliftConfig {
  const config = configFromDiscover(rom, discover(rom));
  return { ...config, modules: config.modules.map((m) => (m.name === 'crt0' ? { ...m, name: 'startup' } : m)) };
}

test('the child, in process: init writes the tree and the config, generate over that config writes the same tree', async () => {
  const runner: EmissionRunner = { ...ROMLIFT_EMISSION, prepare: renamedStartup, generate: generateInto };
  const dir = await mkdtemp(join(tmpdir(), 'romlift-large-rom-test-'));
  try {
    const config = join(dir, 'config.json');
    const init = await runChild(['--child', 'init', '--rom', FAR_JUMP.rom, '--out', join(dir, 'a'), '--config-out', config], runner);
    assert.equal(init.exitCode, 0, init.detail);
    assert.ok(init.maxRssKiB > 0);
    assert.ok(init.treeDigest !== undefined && init.files > 0);
    const generate = await runChild(['--child', 'generate', '--rom', FAR_JUMP.rom, '--out', join(dir, 'b'), '--config', config], runner);
    assert.equal(generate.exitCode, 0, generate.detail);
    assert.equal(generate.treeDigest, init.treeDigest);
    await assert.rejects(runChild(['--child', 'other', '--rom', FAR_JUMP.rom, '--out', dir]), /--child is init or generate/);
    await assert.rejects(runChild(['--child', 'init', '--out', dir]), /needs --rom/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('peakLiveHeapOf: the largest used heap after a full mark-compact, null when none ran', () => {
  const entry = (gcType: string, used: number) => ({ gcType, afterGC: { heapStatistics: { usedHeapSize: used } } });
  assert.equal(peakLiveHeapOf({ statistics: [entry('Scavenge', 900 * 1024 * 1024), entry('MarkSweepCompact', 300 * 1024 * 1024), entry('MarkSweepCompact', 326.2 * 1024 * 1024)] }), 326.2);
  assert.equal(peakLiveHeapOf({ statistics: [entry('Scavenge', 1)] }), null);
  assert.equal(peakLiveHeapOf(undefined), null);
});
