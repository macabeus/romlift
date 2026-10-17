// The provenance checks of architecture §8.6 (D27), run by `bench provenance` and provenance.yml: the
// artifact's source digest equals a recomputation, every real-tier gate of a landed phase is `pass`
// or `historical` in its gate record, every live family ran for every tuning ROM, every tuning dataset
// has a row, and no sealed dataset has one. The checks are pure; `provenanceInputs` gathers their
// inputs from the repository.
import { join } from 'node:path';

import type { Results } from './artifact.ts';
import { readResultsFile } from './artifact.ts';
import { readBaseline } from './baseline.ts';
import { gatesDir, resultsPath, type BenchContext } from './context.ts';
import { isSealed, loadDatasets, type Dataset } from './dataset.ts';
import { currentNodeMajor, sourceDigest } from './digest.ts';
import { familySpec, liveFamilies, type Family } from './families.ts';
import { BenchError, isRecord, readJson } from './files.ts';
import { discoverGateFiles, type GateFile } from './gate-files.ts';

export type ProvenanceCheckId = 'source-digest' | 'gate-record' | 'families' | 'dataset-rows' | 'heldout-rows';

export interface ProvenanceCheck {
  readonly id: ProvenanceCheckId;
  readonly ok: boolean;
  readonly detail: string;
}

export interface ProvenanceInputs {
  /** Undefined when bench/results.json does not exist. */
  readonly artifact: Results | undefined;
  /** The source digest recomputed with the artifact's recorded Node major. */
  readonly recomputedDigest: string;
  readonly landed: number;
  readonly gates: readonly GateFile[];
  readonly datasets: readonly Dataset[];
  /** The tuning ROMs the PoC ran on (its baseline's names); undefined: every tuning dataset. */
  readonly pocRoms?: readonly string[];
}

const NO_ARTIFACT = 'there is no bench/results.json: re-run the real tier';

export function checkSourceDigest(artifact: Results | undefined, recomputed: string): ProvenanceCheck {
  if (artifact === undefined) return { id: 'source-digest', ok: false, detail: NO_ARTIFACT };
  if (artifact.meta.sourceDigest === recomputed) return { id: 'source-digest', ok: true, detail: `source digest ${recomputed} (Node ${artifact.meta.nodeMajor})` };
  return {
    id: 'source-digest',
    ok: false,
    detail: `the artifact's source digest ${artifact.meta.sourceDigest} differs from the sources (${recomputed}): re-run the real tier`,
  };
}

export function checkGateRecord(artifact: Results | undefined, landed: number, gates: readonly GateFile[]): ProvenanceCheck {
  const problems: string[] = [];
  const required = gates.filter((g) => g.phase <= landed);
  const record = new Map((artifact?.gates.real ?? []).map((g) => [g.id, g]));
  let checked = 0;
  for (const g of required) {
    if (g.tier === undefined) {
      problems.push(`${g.file} declares no tier`);
      continue;
    }
    if (g.tier === 'ci') continue;
    checked++;
    const entry = record.get(g.id);
    if (entry === undefined) problems.push(`${g.id} has no real-tier record`);
    else if (entry.verdict !== 'pass' && entry.verdict !== 'historical') problems.push(`${g.id} is ${entry.verdict}`);
  }
  if (artifact === undefined && checked > 0) problems.unshift(NO_ARTIFACT);
  if (problems.length > 0) return { id: 'gate-record', ok: false, detail: problems.join('; ') };
  return { id: 'gate-record', ok: true, detail: `${checked} real-tier gate(s) of phase <= ${landed} pass or are historical` };
}

export function checkFamilies(artifact: Results | undefined, landed: number, datasets: readonly Dataset[], pocRoms?: readonly string[]): ProvenanceCheck {
  const romFamilies = liveFamilies(landed, 'rom');
  const globalFamilies = liveFamilies(landed, 'global');
  if (artifact === undefined) {
    const needed = romFamilies.length + globalFamilies.length > 0;
    return { id: 'families', ok: !needed, detail: needed ? NO_ARTIFACT : `no family is live at phase ${landed}` };
  }
  const problems: string[] = [];
  const notPoc: string[] = [];
  for (const d of datasets.filter((x) => !isSealed(x))) {
    const ran = new Set(artifact.meta.families[d.name] ?? []);
    for (const f of romFamilies) {
      // A family the PoC's dumps measure until a later phase is not asked of a ROM the PoC never ran on.
      const until = familySpec(f).pocUntil;
      if (until !== undefined && landed < until && pocRoms !== undefined && !pocRoms.includes(d.name)) {
        notPoc.push(`${d.name} ${f}`);
        continue;
      }
      if (!ran.has(f)) problems.push(`${d.name}: family ${f} did not run`);
    }
  }
  for (const f of globalFamilies) if (!globalFamilyPresent(artifact, f)) problems.push(`the ${f} family is absent from the artifact`);
  if (problems.length > 0) return { id: 'families', ok: false, detail: problems.join('; ') };
  const live = [...romFamilies, ...globalFamilies];
  const skipped = notPoc.length === 0 ? '' : `; measured by the PoC's dumps until phase 3, not asked of a ROM it never ran on: ${notPoc.join(', ')}`;
  return { id: 'families', ok: true, detail: live.length === 0 ? `no family is live at phase ${landed}` : `live: ${live.join(', ')}${skipped}` };
}

/** Whether the artifact holds the top-level member of a global family; a family whose member the artifact cannot hold yet is absent. */
export function globalFamilyPresent(artifact: Results, family: Family): boolean {
  switch (family) {
    case 'printer':
      return artifact.printer !== undefined;
    default:
      return false;
  }
}

export function checkDatasetRows(artifact: Results | undefined, datasets: readonly Dataset[]): ProvenanceCheck {
  if (artifact === undefined) return { id: 'dataset-rows', ok: false, detail: NO_ARTIFACT };
  const rows = new Set(artifact.roms.map((r) => r.name));
  const missing = datasets.filter((d) => !isSealed(d) && !rows.has(d.name)).map((d) => d.name);
  if (missing.length > 0) return { id: 'dataset-rows', ok: false, detail: `no row for ${missing.join(', ')}` };
  return { id: 'dataset-rows', ok: true, detail: `${rows.size} row(s), one per tuning dataset` };
}

export function checkHeldoutRows(artifact: Results | undefined, datasets: readonly Dataset[]): ProvenanceCheck {
  const sealed = new Set(datasets.filter(isSealed).map((d) => d.name));
  const leaked = (artifact?.roms ?? []).filter((r) => sealed.has(r.name)).map((r) => r.name);
  if (leaked.length > 0) return { id: 'heldout-rows', ok: false, detail: `the artifact holds rows of sealed datasets: ${leaked.join(', ')}` };
  return { id: 'heldout-rows', ok: true, detail: `no row of the ${sealed.size} sealed dataset(s)` };
}

export function provenanceChecks(inputs: ProvenanceInputs): ProvenanceCheck[] {
  return [
    checkSourceDigest(inputs.artifact, inputs.recomputedDigest),
    checkGateRecord(inputs.artifact, inputs.landed, inputs.gates),
    checkFamilies(inputs.artifact, inputs.landed, inputs.datasets, inputs.pocRoms),
    checkDatasetRows(inputs.artifact, inputs.datasets),
    checkHeldoutRows(inputs.artifact, inputs.datasets),
  ];
}

/** `landed` from test/gates/phase.json. */
export async function readLanded(dir: string): Promise<number> {
  const value = await readJson(join(dir, 'phase.json'));
  const landed = isRecord(value) ? value['landed'] : undefined;
  if (typeof landed !== 'number' || !Number.isInteger(landed)) throw new BenchError('test/gates/phase.json must hold {"landed": <integer>}');
  return landed;
}

export interface ProvenanceOptions {
  readonly artifactPath?: string;
  readonly gatesDir?: string;
}

export async function provenanceInputs(cx: BenchContext, options: ProvenanceOptions = {}): Promise<ProvenanceInputs> {
  const artifact = await readResultsFile(options.artifactPath ?? resultsPath(cx));
  const dir = options.gatesDir ?? gatesDir(cx);
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  return {
    artifact,
    recomputedDigest: await sourceDigest(cx.repoRoot, artifact?.meta.nodeMajor ?? currentNodeMajor()),
    landed: await readLanded(dir),
    gates: await discoverGateFiles(dir),
    datasets,
    pocRoms: (await readBaseline(cx)).roms.map((r) => String(r['name'])),
  };
}
