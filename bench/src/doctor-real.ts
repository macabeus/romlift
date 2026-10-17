// `bench doctor-real [--json]` (architecture §8.5, D50): before a real-tier run, checks every local
// input against what is recorded: each tuning ROM's SHA-1, its ELF's sha256, its map, the PoC checkout
// against bench/baseline/poc-source.json, and the binutils, whose versions must equal meta.toolchain
// of the existing results.json when there is one. Every missing or mismatching input is named.
import { join } from 'node:path';

import { sha1Of, sha256Of } from 'romlift/node';

import { readResultsFile, type Toolchain } from './artifact.ts';
import { resultsPath, type BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { BenchError, exists, readFileBytes } from './files.ts';
import { comparePocSource, computePocSource, readPinnedPocSource } from './poc-source.ts';
import { TOOLS, toolchainVersions } from './toolchain.ts';

export interface DoctorCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

async function digestCheck(id: string, path: string, algorithm: 'sha1' | 'sha256', expected: string): Promise<DoctorCheck> {
  if (!(await exists(path))) return { id, ok: false, detail: `${path} is missing` };
  const bytes = await readFileBytes(path);
  const actual = algorithm === 'sha1' ? sha1Of(bytes) : sha256Of(bytes);
  if (actual !== expected) return { id, ok: false, detail: `${path} has ${algorithm} ${actual}, recorded ${expected}` };
  return { id, ok: true, detail: `${path} ${algorithm} ${actual}` };
}

/** The toolchain checks: each tool present, and equal to the artifact's record when one exists. */
export function toolchainChecks(found: Toolchain, recorded: Toolchain | undefined): DoctorCheck[] {
  return (Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map((key) => {
    const id = `toolchain.${key}`;
    const version = found[key];
    if (version === null) return { id, ok: false, detail: `${TOOLS[key]} is missing from PATH` };
    const want = recorded?.[key];
    if (want !== undefined && want !== null && want !== version) return { id, ok: false, detail: `${TOOLS[key]} is '${version}', results.json records '${want}'` };
    return { id, ok: true, detail: version };
  });
}

export async function doctorReal(cx: BenchContext): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const { datasets, problems } = await loadDatasets(cx);
  for (const p of problems) checks.push({ id: `${p.dataset}.dataset`, ok: false, detail: p.detail });
  const tuning = tuningDatasets(datasets);
  if (tuning.length === 0) checks.push({ id: 'datasets', ok: false, detail: 'no tuning datasets in bench/dataset/real' });
  for (const d of tuning) {
    checks.push(await digestCheck(`${d.name}.rom`, join(cx.benchRoot, d.rom), 'sha1', d.sha1));
    checks.push(await digestCheck(`${d.name}.elf`, join(cx.benchRoot, d.elf), 'sha256', d.elfSha256));
    if (d.map === undefined) checks.push({ id: `${d.name}.map`, ok: false, detail: 'the dataset records no map' });
    else {
      const map = join(cx.benchRoot, d.map);
      checks.push((await exists(map)) ? { id: `${d.name}.map`, ok: true, detail: `${map} present` } : { id: `${d.name}.map`, ok: false, detail: `${map} is missing` });
    }
  }
  try {
    const pinned = await readPinnedPocSource(cx);
    const differences = comparePocSource(pinned, await computePocSource(cx.pocRoot));
    checks.push(differences.length === 0 ? { id: 'poc', ok: true, detail: `${cx.pocRoot} matches poc-source.json (${pinned.digest})` } : { id: 'poc', ok: false, detail: differences.join('; ') });
  } catch (error) {
    if (!(error instanceof BenchError)) throw error;
    checks.push({ id: 'poc', ok: false, detail: error.message });
  }
  const recorded = await readResultsFile(resultsPath(cx)).catch(() => undefined);
  checks.push(...toolchainChecks(await toolchainVersions(), recorded?.meta.toolchain));
  return { ok: checks.every((c) => c.ok), checks };
}
