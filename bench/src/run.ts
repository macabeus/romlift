// `bench run [--only <rom>]` (architecture §8.5): scores every tuning dataset and writes
// bench/results.json and bench/timings.json. In phase 1 the rows come from the PoC's dumps
// (bench/.local/poc/<rom>/scored.json, written by export-poc); a ROM or ELF whose digest differs from
// its dataset is refused. The existing gate record is kept only when the sources and inputs it was
// judged on are unchanged.
import { arch, cpus, platform } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { compareCodeUnits } from 'romlift';

import { readResultsFile, writeResultsFile, type GateEntry, type Results, type ResultsMeta, type RomInputs, type Toolchain } from './artifact.ts';
import { resultsPath, timingsPath, type BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { currentNodeMajor, sourceDigest } from './digest.ts';
import { PHASE1_ROM_FAMILIES } from './families.ts';
import { BenchError, isRecord, prettyJson, readJson, writeText } from './files.ts';
import { gitDirty, gitHead } from './git.ts';
import { readPinnedPocSource } from './poc-source.ts';
import { currentPrinterSummary } from './printer.ts';
import { readDatasetInputs, rowOf } from './rescore.ts';
import { summaryLine } from './report.ts';
import type { BenchRow } from './row.ts';
import { toolchainVersions } from './toolchain.ts';

export interface RunOptions {
  readonly only?: string;
  readonly log?: (line: string) => void;
}

export async function romliftVersion(repoRoot: string): Promise<string> {
  const pkg = await readJson(join(repoRoot, 'package.json'));
  return isRecord(pkg) && typeof pkg['version'] === 'string' ? pkg['version'] : '';
}

/** The previous gate record survives only if it was judged on the same sources and inputs. */
export function keptGates(previous: Results | undefined, meta: Pick<ResultsMeta, 'sourceDigest' | 'inputs'>): readonly GateEntry[] {
  if (previous === undefined) return [];
  if (previous.meta.sourceDigest !== meta.sourceDigest || !isDeepStrictEqual(previous.meta.inputs, meta.inputs)) return [];
  return previous.gates.real;
}

export interface RunOutcome {
  readonly results: Results;
  readonly gatesKept: boolean;
}

export async function benchRun(cx: BenchContext, options: RunOptions = {}): Promise<RunOutcome> {
  const log = options.log ?? (() => {});
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const chosen = tuningDatasets(datasets, options.only);
  if (chosen.length === 0) throw new BenchError(options.only === undefined ? 'no tuning datasets' : `no tuning dataset named ${options.only}`);
  const pinned = await readPinnedPocSource(cx);

  const rows: BenchRow[] = [];
  const inputs: Record<string, RomInputs | string> = {};
  const families: Record<string, readonly string[]> = {};
  const timings: Record<string, { readonly scoreMs: number }> = {};
  for (const d of chosen) {
    const started = performance.now();
    const read = await readDatasetInputs(cx, d);
    if (read.dump.pocSourceDigest !== pinned.digest) {
      throw new BenchError(`${d.name}: the dump was made from PoC source ${read.dump.pocSourceDigest}, not the pinned ${pinned.digest}: re-run export-poc`);
    }
    const row = rowOf(read);
    rows.push(row);
    inputs[d.name] = { sha1: read.sha1, elfSha256: read.elfSha256 };
    families[d.name] = [...PHASE1_ROM_FAMILIES].sort(compareCodeUnits);
    timings[d.name] = { scoreMs: Math.round(performance.now() - started) };
    log(summaryLine(row));
  }
  inputs['pocSourceDigest'] = pinned.digest;

  const nodeMajor = currentNodeMajor();
  const toolchain: Toolchain = await toolchainVersions();
  const meta: ResultsMeta = {
    commit: await gitHead(cx.repoRoot),
    dirty: await gitDirty(cx.repoRoot),
    sourceDigest: await sourceDigest(cx.repoRoot, nodeMajor),
    nodeMajor,
    romliftVersion: await romliftVersion(cx.repoRoot),
    inputs,
    toolchain,
    families,
    source: 'poc',
  };
  const previous = await readResultsFile(resultsPath(cx)).catch(() => undefined);
  const gates = keptGates(previous, meta);
  const printer = await currentPrinterSummary(cx, toolchain.as);
  const results: Results = { meta, ...(printer === undefined ? {} : { printer }), gates: { real: gates }, roms: rows };
  await writeResultsFile(resultsPath(cx), results);
  const cpu = cpus()[0]?.model ?? 'unknown';
  await writeText(
    timingsPath(cx),
    prettyJson({ generatedAt: new Date().toISOString(), machine: { platform: platform(), arch: arch(), cpu, node: process.version }, roms: timings }),
  );
  return { results, gatesKept: gates.length > 0 };
}
