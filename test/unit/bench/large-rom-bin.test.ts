// bench/src/large-rom-bin.ts: the launcher's Node options, what one finished CLI process reports, and the verdict of
// `large-rom --bin` (phase-3.md, fix round 4), with init, generate and update in a project directory (roadmap 4.E).
// The real runs are test/local/large-rom-bin.test.ts's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { allCompleted, BIN_RUNS, binRunOf, CLI_MAIN, completed, largeRomBin, launcherOptions, type BinRun } from '../../../bench/src/large-rom-bin.ts';

const EXPLAIN_JSON: BinRun = { command: 'explain --json', args: [], json: true };

test("launcherOptions reads the bin's first line; src/cli/main.ts caps the old space at 1,024 MiB (D72)", () => {
  assert.deepEqual(launcherOptions('#!/usr/bin/env -S node --max-old-space-size=384\n// x'), ['--max-old-space-size=384']);
  assert.deepEqual(launcherOptions('#!/usr/bin/env -S node\n'), []);
  assert.throws(() => launcherOptions('// no launcher\n'), /not the bin's launcher/);
  assert.deepEqual(launcherOptions(readFileSync(CLI_MAIN, 'utf8')), ['--max-old-space-size=1024']);
});

test('binRunOf: the RSS and live-heap lines and the summary; an aborted process has neither and its FATAL line', () => {
  const done = binRunOf(EXPLAIN_JSON, { code: 0, stdout: '{"type":"explain"}\n{"type":"summary","ok":true}\n', stderr: 'warn\n\nromlift-bench-rss 838860\nromlift-bench-live-heap 352.25\n' });
  assert.deepEqual(done, { command: 'explain --json', exitCode: 0, maxRssMiB: 819.2, peakLiveHeapMiB: 352.25, summaryOk: true, detail: 'ok summary' });
  assert.ok(completed(EXPLAIN_JSON, done));
  const failed = binRunOf(EXPLAIN_JSON, { code: 0, stdout: '{"type":"summary","ok":false}\n', stderr: '' });
  assert.equal(failed.detail, 'no ok summary');
  assert.ok(!completed(EXPLAIN_JSON, failed));
  const aborted = binRunOf(EXPLAIN_JSON, { code: 128, stdout: '', stderr: 'FATAL ERROR: Reached heap limit Allocation failed\nkilled by SIGABRT\n' });
  assert.deepEqual(aborted, { command: 'explain --json', exitCode: 128, maxRssMiB: null, peakLiveHeapMiB: null, summaryOk: false, detail: 'FATAL ERROR: Reached heap limit Allocation failed' });
  const text = binRunOf({ command: 'explain', args: [], json: false }, { code: 0, stdout: 'explain: ok\n', stderr: '\nromlift-bench-rss 1024\nromlift-bench-live-heap -\n' });
  assert.deepEqual(text, { command: 'explain', exitCode: 0, maxRssMiB: 1, peakLiveHeapMiB: null, detail: 'completed' });
});

test('largeRomBin runs every command with the launcher options and the RSS probe, and allCompleted judges them', async () => {
  const image = Uint8Array.from({ length: 64 }, (_, i) => i);
  const calls: (readonly string[])[] = [];
  const places: { readonly command: string; readonly cwd: string | undefined; readonly files: readonly string[] }[] = [];
  const report = await largeRomBin({
    image: async () => image,
    spawn: async (args, cwd) => {
      calls.push(args);
      places.push({ command: args.slice(5).join(' '), cwd, files: cwd === undefined ? [] : await readdir(cwd) });
      if (cwd !== undefined && args[5] === 'init') await writeFile(join(cwd, 'romlift.toml'), '');
      return { code: 0, stdout: '{"type":"summary","ok":true}\n', stderr: 'romlift-bench-rss 2048\nromlift-bench-live-heap 1.50\n' };
    },
    log: () => {},
  });
  // The project runs come last, in one directory: init finds only the ROM as baserom.gba, generate and update the project
  // init wrote.
  const project = places.filter((p) => p.cwd !== undefined);
  assert.deepEqual(project.map((p) => [p.command, p.files]), [
    ['init baserom.gba --json', ['baserom.gba']],
    ['generate --json', ['baserom.gba', 'romlift.toml']],
    ['update --json', ['baserom.gba', 'romlift.toml']],
  ]);
  assert.ok(project.every((p) => p.cwd === project[0]?.cwd));
  assert.deepEqual(places.slice(-3), project, 'every other command runs in the bench\'s own directory');
  assert.deepEqual(report.nodeOptions, ['--max-old-space-size=1024']);
  assert.deepEqual(report.runs.map((r) => r.command), BIN_RUNS.map((r) => r.command));
  assert.deepEqual(BIN_RUNS.slice(-3).map((r) => [r.command, r.inProject]), [['init --json', true], ['generate --json', true], ['update --json', true]]);
  assert.ok(report.runs.every((r) => r.peakLiveHeapMiB === 1.5));
  assert.ok(calls.every((a) => a[0] === '--conditions=source' && a[1] === '--max-old-space-size=1024' && a[2] === '--import' && a[4] === CLI_MAIN));
  assert.ok(calls.every((a) => !a.includes('{rom}')), 'the ROM path replaces the placeholder');
  assert.ok(allCompleted(report));
  assert.ok(!allCompleted({ ...report, runs: report.runs.slice(1) }));
});
