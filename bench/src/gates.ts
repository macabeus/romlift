// `bench gates [--require <n>] [--tier ci|real] [--dir <gates dir>]` (architecture §10, D29): runs every
// gate test file with node --test, one at a time, collects the NDJSON verdict lines test/gates/gate.ts
// appends to $ROMLIFT_GATE_REPORT, and prints every gate sorted by id with its verdict, detail and
// input digests. With --require n it fails when a gate of phase <= n in the selected tier is pending,
// fail or unavailable, or when a gate file of phase <= n that runs in that tier left no record. With
// --tier real the records become the gate record of bench/results.json.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';

import { readResultsFile, writeResultsFile, type GateEntry } from './artifact.ts';
import type { BenchContext } from './context.ts';
import { BenchError, exists, isRecord, readText } from './files.ts';
import { discoverGateFiles, includesTier, type GateFile } from './gate-files.ts';
import { runProcess } from './process.ts';

export type Tier = 'ci' | 'real';
const VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'pending', 'unavailable', 'historical']);

/** One line of the gate report, as test/gates/gate.ts formats it. */
export interface GateReportLine {
  readonly id: string;
  readonly phase: number;
  readonly tier: Tier;
  readonly verdict: string;
  readonly detail: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly missing: readonly string[];
}

/** Parses the NDJSON report; the last record of an id wins. Malformed lines throw. */
export function parseGateReport(text: string): GateReportLine[] {
  const byId = new Map<string, GateReportLine>();
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new BenchError(`gate report line ${i + 1} is not JSON`);
    }
    if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['phase'] !== 'number' || typeof value['verdict'] !== 'string' || !VERDICTS.has(value['verdict'])) {
      throw new BenchError(`gate report line ${i + 1} is not a gate record`);
    }
    const tier = value['tier'];
    if (tier !== 'ci' && tier !== 'real') throw new BenchError(`gate report line ${i + 1} has tier ${String(tier)}`);
    const inputs: Record<string, string> = {};
    if (isRecord(value['inputs'])) for (const [k, v] of Object.entries(value['inputs'])) if (typeof v === 'string') inputs[k] = v;
    const missing = Array.isArray(value['missing']) ? value['missing'].filter((m): m is string => typeof m === 'string') : [];
    byId.set(value['id'], { id: value['id'], phase: value['phase'], tier, verdict: value['verdict'], detail: typeof value['detail'] === 'string' ? value['detail'] : '', inputs, missing });
  }
  return Array.from(byId.values()).sort((a, b) => compareCodeUnits(a.id, b.id));
}

/** Why `--require n` fails, or nothing. */
export function requireFailures(records: readonly GateReportLine[], files: readonly GateFile[], require: number, tier: Tier): string[] {
  const failures: string[] = [];
  const recorded = new Set(records.map((r) => r.id));
  for (const r of records) {
    if (r.phase <= require && r.tier === tier && r.verdict !== 'pass' && r.verdict !== 'historical') failures.push(`${r.id} is ${r.verdict}: ${r.detail}`);
  }
  for (const f of files) {
    if (f.phase > require || recorded.has(f.id)) continue;
    if (f.tier === undefined) failures.push(`${f.file} left no record (its tier is not declared)`);
    else if (includesTier(f.tier, tier)) failures.push(`${f.file} left no record in tier ${tier}`);
  }
  return failures;
}

export function formatGateLine(r: GateReportLine): string {
  const inputs = Object.keys(r.inputs)
    .sort(compareCodeUnits)
    .map((k) => `${k}=${r.inputs[k] ?? ''}`)
    .join(' ');
  return `${r.id.padEnd(32)} ${r.verdict.padEnd(11)} ${r.detail}${inputs === '' ? '' : `  [${inputs}]`}`;
}

export interface GatesOptions {
  readonly tier: Tier;
  readonly require?: number;
  readonly dir: string;
  /** Where --tier real writes the gate record. */
  readonly resultsPath: string;
  readonly log: (line: string) => void;
}

export interface GatesOutcome {
  readonly records: readonly GateReportLine[];
  readonly failures: readonly string[];
  /** The test runner's output, for diagnosis. */
  readonly runnerOutput: string;
}

export async function runGates(cx: BenchContext, options: GatesOptions): Promise<GatesOutcome> {
  const files = await discoverGateFiles(options.dir);
  const scratch = await mkdtemp(join(tmpdir(), 'romlift-gates-'));
  const report = join(scratch, 'report.ndjson');
  let records: GateReportLine[] = [];
  let runnerOutput = '';
  try {
    if (files.length > 0) {
      const run = await runProcess(process.execPath, ['--conditions=source', '--test', '--test-concurrency=1', ...files.map((f) => join(options.dir, f.file))], {
        cwd: cx.repoRoot,
        // NODE_TEST_CONTEXT is cleared so the runner also works when `bench gates` itself runs under node --test.
        env: { ROMLIFT_GATE_TIER: options.tier, ROMLIFT_GATE_REPORT: report, ROMLIFT_BENCH_ROOT: cx.benchRoot, ROMLIFT_POC: cx.pocRoot, NODE_TEST_CONTEXT: undefined },
      });
      runnerOutput = run.stdout + run.stderr;
      records = (await exists(report)) ? parseGateReport(await readText(report)) : [];
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  for (const r of records) options.log(formatGateLine(r));
  const failures = options.require === undefined ? [] : requireFailures(records, files, options.require, options.tier);
  if (options.tier === 'real') {
    const artifact = await readResultsFile(options.resultsPath);
    if (artifact === undefined) throw new BenchError(`${options.resultsPath} does not exist: run npm run bench -- run first`);
    const real: GateEntry[] = records.filter((r) => r.tier === 'real').map((r) => ({ id: r.id, verdict: r.verdict, inputs: r.inputs, detail: r.detail }));
    await writeResultsFile(options.resultsPath, { ...artifact, gates: { real } });
    options.log(`wrote ${real.length} real-tier gate record(s) into ${options.resultsPath}`);
  }
  return { records, failures, runnerOutput };
}
