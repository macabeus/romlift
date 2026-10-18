// `bench speed [--only <rom>] [--json] [--write-baseline]` (architecture §8.4 "Speed", §9.3, D41): one
// ROM at a time, in this process, no workers. Per ROM a warm-up run, then the median CPU time of five
// (process.cpuUsage), the wall time for information. A fixed calibration workload is measured the same
// way, so the ratchet against bench/baseline/speed.json scales by the ratio of this machine to the one
// that wrote it: a ROM passes when its CPU time is at most 1.5 x its baseline x the ratio. The command
// never writes speed.json; only the phase lead raises it, with --write-baseline (D43).
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';

import { analysisTuning, benchProfile, DEFAULT_RUN_TUNING, discoverOptions, measure, readRealInputs, type AnalysisRunner } from './analysis-run.ts';
import { baselineDir, type BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';

export const SPEED_SCHEMA = 'romlift/bench-speed@1';
export const SPEED_BASELINE_SCHEMA = 'romlift-bench/speed@1';
/** The ratchet of D41: the median CPU time may be at most this multiple of the baseline (calibrated). */
export const SPEED_RATCHET = 1.5;
export const SPEED_RUNS = 5;

/** bench/baseline/speed.json: the calibration's CPU time and each ROM's median analysis CPU time on the machine that wrote it. */
export interface SpeedBaseline {
  readonly schema: typeof SPEED_BASELINE_SCHEMA;
  readonly calibration: { readonly cpuMs: number };
  readonly roms: Readonly<Record<string, { readonly analysisCpuMs: number }>>;
}

export interface SpeedRom {
  readonly name: string;
  readonly analysisCpuMs: number;
  readonly wallMs: number;
  /** 0 when the baseline does not hold the ROM. */
  readonly baselineCpuMs: number;
}

/** The --json line (frozen by test/gates/g2.speed.test.ts). */
export interface SpeedReport {
  readonly schema: typeof SPEED_SCHEMA;
  /** ratio = cpuMs / baselineCpuMs; 0 without a baseline. */
  readonly calibration: { readonly cpuMs: number; readonly baselineCpuMs: number; readonly ratio: number };
  readonly roms: readonly SpeedRom[];
}

/** The median of a non-empty list. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new BenchError('the median of no value');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** A fixed, deterministic CPU workload (xorshift fills and numeric sorts); returns a checksum so it is never elided. */
export function calibrationWorkload(size = 200_000, rounds = 4): number {
  const values = new Uint32Array(size);
  let x = 0x9e3779b9;
  let checksum = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < size; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      values[i] = x;
    }
    values.sort((a, b) => a - b);
    checksum = (checksum ^ (values[size >> 1] ?? 0)) >>> 0;
  }
  return checksum;
}

export interface MedianTimes {
  readonly cpuMs: number;
  readonly wallMs: number;
}

/** A warm-up run of `fn`, then the median CPU and wall times of `runs` runs. */
export function medianTimes(fn: () => unknown, runs = SPEED_RUNS): MedianTimes {
  fn();
  const cpu: number[] = [];
  const wall: number[] = [];
  for (let i = 0; i < runs; i++) {
    const m = measure(fn);
    cpu.push(m.cpuMs);
    wall.push(m.wallMs);
  }
  return { cpuMs: median(cpu), wallMs: median(wall) };
}

/** cpuMs / baselineCpuMs, or 0 when there is no baseline. */
export function calibrationRatio(cpuMs: number, baselineCpuMs: number): number {
  return baselineCpuMs > 0 ? cpuMs / baselineCpuMs : 0;
}

/** Whether a ROM is within the ratchet; false when there is no baseline for it or for the calibration. */
export function withinRatchet(rom: Pick<SpeedRom, 'analysisCpuMs' | 'baselineCpuMs'>, ratio: number): boolean {
  return rom.baselineCpuMs > 0 && ratio > 0 && rom.analysisCpuMs <= SPEED_RATCHET * rom.baselineCpuMs * ratio;
}

export function parseSpeedBaseline(value: unknown, where: string): SpeedBaseline {
  if (!isRecord(value) || value['schema'] !== SPEED_BASELINE_SCHEMA || !isRecord(value['calibration']) || !isRecord(value['roms'])) {
    throw new BenchError(`${where}: expected {"schema": "${SPEED_BASELINE_SCHEMA}", "calibration": {"cpuMs"}, "roms": {...}}`);
  }
  const cpu = value['calibration']['cpuMs'];
  if (typeof cpu !== 'number' || !(cpu > 0)) throw new BenchError(`${where}: calibration.cpuMs must be a positive number`);
  const roms: Record<string, { readonly analysisCpuMs: number }> = {};
  for (const [name, entry] of Object.entries(value['roms'])) {
    const ms = isRecord(entry) ? entry['analysisCpuMs'] : undefined;
    if (typeof ms !== 'number' || !(ms > 0)) throw new BenchError(`${where}: roms.${name}.analysisCpuMs must be a positive number`);
    roms[name] = { analysisCpuMs: ms };
  }
  return { schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: cpu }, roms };
}

export const speedBaselinePath = (cx: BenchContext): string => join(baselineDir(cx), 'speed.json');

export async function readSpeedBaseline(cx: BenchContext): Promise<SpeedBaseline | undefined> {
  const path = speedBaselinePath(cx);
  if (!(await exists(path))) return undefined;
  return parseSpeedBaseline(await readJson(path), path);
}

/** The baseline a measurement raises it to: the new calibration, and each measured ROM replaced, the others kept. */
export function raisedBaseline(previous: SpeedBaseline | undefined, report: SpeedReport): SpeedBaseline {
  const roms: Record<string, { readonly analysisCpuMs: number }> = { ...(previous?.roms ?? {}) };
  for (const r of report.roms) roms[r.name] = { analysisCpuMs: positiveMs(r.analysisCpuMs) };
  const sorted: Record<string, { readonly analysisCpuMs: number }> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) {
    const entry = roms[name];
    if (entry !== undefined) sorted[name] = entry;
  }
  return { schema: SPEED_BASELINE_SCHEMA, calibration: { cpuMs: positiveMs(report.calibration.cpuMs) }, roms: sorted };
}

/** A time for speed.json: hundredths of a millisecond, never 0 (a baseline of 0 holds nothing). */
function positiveMs(ms: number): number {
  return Math.max(0.01, Math.round(ms * 100) / 100);
}

export interface SpeedOptions {
  readonly only?: string;
  readonly runner: AnalysisRunner;
  readonly log?: (line: string) => void;
  /** The phase lead's flag: write the measurement into bench/baseline/speed.json. */
  readonly writeBaseline?: boolean;
  /** The calibration workload (tests pass a cheaper one). */
  readonly calibrate?: () => unknown;
}

/** Measures the calibration and every tuning ROM (never a sealed one), serially, in this process. */
export async function benchSpeed(cx: BenchContext, options: SpeedOptions): Promise<SpeedReport> {
  const log = options.log ?? (() => {});
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const chosen = tuningDatasets(datasets, options.only);
  if (chosen.length === 0) throw new BenchError(options.only === undefined ? 'no tuning datasets' : `no tuning dataset named ${options.only}`);
  const baseline = await readSpeedBaseline(cx);
  const calibration = medianTimes(options.calibrate ?? (() => calibrationWorkload()));
  const baselineCalibration = baseline?.calibration.cpuMs ?? 0;
  const ratio = calibrationRatio(calibration.cpuMs, baselineCalibration);
  log(`calibration ${calibration.cpuMs.toFixed(1)} ms CPU${baseline === undefined ? ' (no bench/baseline/speed.json)' : `, baseline ${baselineCalibration} ms, ratio ${ratio.toFixed(3)}`}`);
  const profile = benchProfile();
  const tuning = analysisTuning(DEFAULT_RUN_TUNING);
  const roms: SpeedRom[] = [];
  for (const d of chosen) {
    const inputs = await readRealInputs(cx, d);
    let times: MedianTimes;
    try {
      times = medianTimes(() => options.runner.analyze(inputs.rom, profile, discoverOptions(), tuning));
    } catch (error) {
      throw new BenchError(`${d.name}: the analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rom: SpeedRom = { name: d.name, analysisCpuMs: times.cpuMs, wallMs: times.wallMs, baselineCpuMs: baseline?.roms[d.name]?.analysisCpuMs ?? 0 };
    roms.push(rom);
    const limit = SPEED_RATCHET * rom.baselineCpuMs * ratio;
    log(`${d.name.padEnd(12)} ${rom.analysisCpuMs.toFixed(1)} ms CPU, ${rom.wallMs.toFixed(1)} ms wall, ${rom.baselineCpuMs > 0 ? `limit ${limit.toFixed(1)} ms: ${withinRatchet(rom, ratio) ? 'ok' : 'SLOWER'}` : 'no baseline'}`);
  }
  const report: SpeedReport = { schema: SPEED_SCHEMA, calibration: { cpuMs: calibration.cpuMs, baselineCpuMs: baselineCalibration, ratio }, roms };
  if (options.writeBaseline === true) {
    await writeText(speedBaselinePath(cx), prettyJson(raisedBaseline(baseline, report)));
    log('wrote bench/baseline/speed.json (the phase lead commits it)');
  }
  return report;
}

/** Whether every ROM of the report is within the ratchet. */
export function speedPasses(report: SpeedReport): boolean {
  return report.roms.length > 0 && report.roms.every((r) => withinRatchet(r, report.calibration.ratio));
}
