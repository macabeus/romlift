// `bench speed` (D41): the median and calibration math, the ratchet, the baseline file, and the command
// on the synthetic tier: the frozen --json shape, no write of speed.json unless --write-baseline.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import type { AnalysisRunner } from '../../../bench/src/analysis-run.ts';
import { main, type BenchIo } from '../../../bench/src/cli.ts';
import {
  calibrationRatio,
  calibrationWorkload,
  median,
  medianTimes,
  parseSpeedBaseline,
  raisedBaseline,
  SPEED_BASELINE_SCHEMA,
  withinRatchet,
  type SpeedReport,
} from '../../../bench/src/speed.ts';
import { failingRunner, withTempDir } from './fixtures.ts';
import { syntheticTier, TINY_DEPS } from './harness.ts';

test('median of odd and even counts, unsorted input', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.throws(() => median([]), /the median of no value/);
});

test('medianTimes runs a warm-up and then the given number of measured runs', () => {
  let calls = 0;
  const t = medianTimes(() => calls++, 5);
  assert.equal(calls, 6);
  assert.ok(t.cpuMs >= 0 && t.wallMs >= 0);
});

test('the calibration workload is deterministic', () => {
  assert.equal(calibrationWorkload(1000, 2), calibrationWorkload(1000, 2));
  assert.notEqual(calibrationWorkload(1000, 2), calibrationWorkload(1000, 3));
});

test('the ratio and the ratchet: at most 1.5 x baseline x ratio; no baseline never passes', () => {
  assert.equal(calibrationRatio(150, 100), 1.5);
  assert.equal(calibrationRatio(150, 0), 0);
  assert.ok(withinRatchet({ analysisCpuMs: 225, baselineCpuMs: 100 }, 1.5));
  assert.ok(!withinRatchet({ analysisCpuMs: 226, baselineCpuMs: 100 }, 1.5));
  assert.ok(withinRatchet({ analysisCpuMs: 75, baselineCpuMs: 100 }, 0.5));
  assert.ok(!withinRatchet({ analysisCpuMs: 1, baselineCpuMs: 0 }, 1));
  assert.ok(!withinRatchet({ analysisCpuMs: 1, baselineCpuMs: 100 }, 0));
});

test('speed.json: parsed strictly, and raised with the measured ROMs replaced and the others kept, by name', () => {
  const base = parseSpeedBaseline({ schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: 100 }, roms: { sa3: { analysisCpuMs: 900 }, fe7j: { analysisCpuMs: 800 } } }, 'x');
  assert.throws(() => parseSpeedBaseline({ schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: 0 }, roms: {} }, 'x'), /calibration\.cpuMs must be a positive number/);
  assert.throws(() => parseSpeedBaseline({ schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: 1 }, roms: { a: {} } }, 'x'), /roms\.a\.analysisCpuMs/);
  const report: SpeedReport = { schema: 'romlift/bench-speed@1', calibration: { cpuMs: 123.456, baselineCpuMs: 100, ratio: 1.23 }, roms: [{ name: 'fe7j', analysisCpuMs: 700.04, wallMs: 701, baselineCpuMs: 800 }] };
  const raised = raisedBaseline(base, report);
  assert.deepEqual(raised, { schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: 123.46 }, roms: { fe7j: { analysisCpuMs: 700.04 }, sa3: { analysisCpuMs: 900 } } });
  assert.deepEqual(Object.keys(raised.roms), ['fe7j', 'sa3']);
});

function capture(): BenchIo & { readonly lines: string[] } {
  const lines: string[] = [];
  return { lines, out: (l) => lines.push(l), err: () => {} };
}

test('bench speed --json prints the frozen shape, never writes speed.json, and the lead raises it with --write-baseline', async () => {
  await withTempDir('romlift-speed-', async (root) => {
    const cx = await syntheticTier(root);
    const deps = { ...TINY_DEPS, calibrate: () => calibrationWorkload(20_000, 1) };
    const path = join(cx.repoRoot, 'bench', 'baseline', 'speed.json');
    let io = capture();
    // Without a baseline the ratchet cannot hold: exit 1, baselines 0.
    assert.equal(await main(['speed', '--json'], cx, io, deps), 1);
    const first = JSON.parse(io.lines.at(-1) ?? '') as SpeedReport;
    assert.deepEqual(Object.keys(first), ['schema', 'calibration', 'roms']);
    assert.equal(first.schema, 'romlift/bench-speed@1');
    assert.deepEqual(Object.keys(first.calibration), ['cpuMs', 'baselineCpuMs', 'ratio']);
    assert.deepEqual(first.calibration.baselineCpuMs, 0);
    assert.deepEqual(first.calibration.ratio, 0);
    assert.deepEqual(first.roms.map((r) => [r.name, Object.keys(r), r.baselineCpuMs]), [['tiny', ['name', 'analysisCpuMs', 'wallMs', 'baselineCpuMs'], 0]]);
    await assert.rejects(readFile(path, 'utf8'), /ENOENT/);
    assert.equal(await main(['speed', '--write-baseline'], cx, (io = capture()), deps), 0);
    const written = parseSpeedBaseline(JSON.parse(await readFile(path, 'utf8')), path);
    assert.deepEqual(Object.keys(written.roms), ['tiny']);
    // A generous baseline passes; a tiny one fails the ratchet.
    await writeFile(path, JSON.stringify({ schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: first.calibration.cpuMs || 1 }, roms: { tiny: { analysisCpuMs: 1e6 } } }));
    assert.equal(await main(['speed', '--json', '--only', 'tiny'], cx, (io = capture()), deps), 0);
    const passing = JSON.parse(io.lines.at(-1) ?? '') as SpeedReport;
    assert.equal(passing.roms[0]?.baselineCpuMs, 1e6);
    assert.ok(passing.calibration.ratio > 0);
    await writeFile(path, JSON.stringify({ schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: 1e6 }, roms: { tiny: { analysisCpuMs: 1e-6 } } }));
    // The fixed runner can measure 0 ms, which no limit fails; this one always spends some CPU.
    const busy: AnalysisRunner = {
      analyze: (...args) => {
        calibrationWorkload(20_000, 1);
        return deps.runner.analyze(...args);
      },
      diagnose: (...args) => deps.runner.diagnose(...args),
    };
    assert.equal(await main(['speed', '--json'], cx, (io = capture()), { ...deps, runner: busy }), 1);
    // A failing analysis and an unknown ROM are refused.
    assert.equal(await main(['speed'], cx, capture(), { ...deps, runner: failingRunner() }), 1);
    assert.equal(await main(['speed', '--only', 'nope'], cx, capture(), deps), 1);
  });
});
