// bench/src/large-rom-bin.ts: the launcher's Node options, what one finished CLI process reports, and the verdict of
// `large-rom --bin` (phase-3.md, fix round 4). The real runs are test/local/large-rom-bin.test.ts's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { allCompleted, BIN_RUNS, binRunOf, CLI_MAIN, completed, largeRomBin, launcherOptions, type BinRun } from '../../../bench/src/large-rom-bin.ts';

const SHA = 'b846b9453414ce93afc5e8fd559eaac582dc570e';
const VERIFY_LINK: BinRun = { command: 'verify --link', args: [], json: true, link: true };

test("launcherOptions reads the bin's first line; src/cli/main.ts caps the old space at 384 MiB (D69)", () => {
  assert.deepEqual(launcherOptions('#!/usr/bin/env -S node --max-old-space-size=384\n// x'), ['--max-old-space-size=384']);
  assert.deepEqual(launcherOptions('#!/usr/bin/env -S node\n'), []);
  assert.throws(() => launcherOptions('// no launcher\n'), /not the bin's launcher/);
  assert.deepEqual(launcherOptions(readFileSync(CLI_MAIN, 'utf8')), ['--max-old-space-size=384']);
});

test('binRunOf: the RSS and live-heap lines, the summary, the linked SHA-1; an aborted process has neither and its FATAL line', () => {
  const done = binRunOf(
    VERIFY_LINK,
    { code: 0, stdout: `{"type":"check"}\n{"type":"summary","ok":true,"sha1":"${SHA}"}\n`, stderr: 'warn\n\nromlift-bench-rss 838860\nromlift-bench-live-heap 352.25\n' },
    SHA,
  );
  assert.deepEqual(done, { command: 'verify --link', exitCode: 0, maxRssMiB: 819.2, peakLiveHeapMiB: 352.25, summaryOk: true, sha1: SHA, detail: 'ok summary' });
  assert.ok(completed(VERIFY_LINK, done, SHA));
  const other = binRunOf(VERIFY_LINK, { code: 0, stdout: '{"type":"summary","ok":true,"sha1":"00"}\n', stderr: '' }, SHA);
  assert.equal(other.detail, 'ok summary, linked 00');
  assert.ok(!completed(VERIFY_LINK, other, SHA));
  const aborted = binRunOf(VERIFY_LINK, { code: 128, stdout: '', stderr: 'FATAL ERROR: Reached heap limit Allocation failed\nkilled by SIGABRT\n' }, SHA);
  assert.deepEqual(aborted, { command: 'verify --link', exitCode: 128, maxRssMiB: null, peakLiveHeapMiB: null, summaryOk: false, detail: 'FATAL ERROR: Reached heap limit Allocation failed' });
  const text = binRunOf({ command: 'analyze', args: [], json: false }, { code: 0, stdout: 'analyze: ok\n', stderr: '\nromlift-bench-rss 1024\nromlift-bench-live-heap -\n' }, SHA);
  assert.deepEqual(text, { command: 'analyze', exitCode: 0, maxRssMiB: 1, peakLiveHeapMiB: null, detail: 'completed' });
});

test('largeRomBin runs every command with the launcher options and the RSS probe, and allCompleted judges them', async () => {
  const image = Uint8Array.from({ length: 64 }, (_, i) => i);
  const calls: (readonly string[])[] = [];
  const report = await largeRomBin({
    image: async () => image,
    spawn: async (args) => {
      calls.push(args);
      return { code: 0, stdout: '{"type":"summary","ok":true,"sha1":"c6138d514ffa2135bfce0ed0b8fac65669917ec7"}\n', stderr: 'romlift-bench-rss 2048\nromlift-bench-live-heap 1.50\n' };
    },
    log: () => {},
  });
  assert.deepEqual(report.nodeOptions, ['--max-old-space-size=384']);
  assert.deepEqual(report.runs.map((r) => r.command), BIN_RUNS.map((r) => r.command));
  assert.ok(report.runs.every((r) => r.peakLiveHeapMiB === 1.5));
  assert.ok(calls.every((a) => a[0] === '--conditions=source' && a[1] === '--max-old-space-size=384' && a[2] === '--import' && a[4] === CLI_MAIN));
  assert.ok(calls.every((a) => !a.includes('{rom}')), 'the ROM path replaces the placeholder');
  assert.ok(allCompleted(report));
  assert.ok(!allCompleted({ ...report, runs: report.runs.slice(1) }));
});
