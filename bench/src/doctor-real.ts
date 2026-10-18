// `bench doctor-real [--json]` (architecture §8.5, D50): before a real-tier run, checks every local
// input against what is recorded: each tuning ROM's SHA-1, its ELF's sha256, its map, its reference objects
// (`objectsDir` against `objectsDigest`, and every object the map links present there with the sizes the
// map gives its code and data), the PoC checkout against bench/baseline/poc-source.json, the binutils,
// whose versions must equal meta.toolchain of the existing results.json when there is one, and objdiff-cli
// against bench/tools/objdiff.version. Every missing or mismatching input is named.
import { join } from 'node:path';

import { parseElf, parseGnuMap } from 'romlift';
import { sha1Of, sha256Of } from 'romlift/node';

import { readResultsFile, type Toolchain } from './artifact.ts';
import { resultsPath, type BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets, type Dataset } from './dataset.ts';
import { BenchError, exists, isDirectory, readFileBytes, readText } from './files.ts';
import { findObjdiff, mainRepoRootOf, OBJDIFF_ENV, OBJDIFF_VERSION_FILE, objdiffVersion, readPinnedObjdiffVersion, type ObjdiffLocation } from './objdiff-cli.ts';
import { linkedSectionMismatches, listObjectFiles, mapObjects, objectsDigest } from './objects.ts';
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

/**
 * The objects check of one dataset: `objectsDir` exists and its digest equals `objectsDigest`. A tuning
 * dataset without the two fields fails, since the objdiff family needs every tuning ROM's objects.
 */
export async function objectsCheck(d: Dataset, benchRoot: string): Promise<DoctorCheck> {
  const id = `${d.name}.objects`;
  if (d.objectsDir === undefined || d.objectsDigest === undefined) return { id, ok: false, detail: 'the dataset records no objectsDir and objectsDigest' };
  const dir = join(benchRoot, d.objectsDir);
  if (!(await isDirectory(dir))) return { id, ok: false, detail: `${dir} is missing` };
  const [count, digest] = [(await listObjectFiles(dir)).length, await objectsDigest(dir)];
  if (digest !== d.objectsDigest) return { id, ok: false, detail: `${dir} (${count} objects) has digest ${digest}, recorded ${d.objectsDigest}` };
  return { id, ok: true, detail: `${dir} ${count} objects sha256 ${digest}` };
}

/**
 * Whether `objectsDir` holds the objects the reference map links: each object the map names (paths are
 * relative to the directory ld ran in, which is `objectsDir` for every tuning build) exists there and its
 * code and data sections have the sizes the map gives them. Archive members (libgcc, libc, libagbsyscall)
 * lie outside every objects directory and are counted, not checked.
 */
export async function linkedObjectsCheck(d: Dataset, benchRoot: string): Promise<DoctorCheck> {
  const id = `${d.name}.objects-linked`;
  if (d.objectsDir === undefined || d.map === undefined) return { id, ok: false, detail: 'the dataset records no objectsDir or no map' };
  const mapPath = join(benchRoot, d.map);
  const dir = join(benchRoot, d.objectsDir);
  if (!(await exists(mapPath)) || !(await isDirectory(dir))) return { id, ok: false, detail: `${(await exists(mapPath)) ? dir : mapPath} is missing` };
  const parsed = parseGnuMap(await readText(mapPath));
  if (!parsed.ok) return { id, ok: false, detail: `${mapPath}: ${parsed.error}` };
  const linked = mapObjects(parsed.value);
  if (linked.objects.length === 0) return { id, ok: false, detail: `${mapPath} links no object file` };
  const problems: string[] = [];
  for (const object of linked.objects) {
    const file = join(dir, object.file);
    if (!(await exists(file))) {
      problems.push(`${object.file} is missing`);
      continue;
    }
    const elf = parseElf(await readFileBytes(file));
    if (!elf.ok) problems.push(`${object.file}: ${elf.error}`);
    else problems.push(...linkedSectionMismatches(object, elf.value));
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('; ');
    return { id, ok: false, detail: `${problems.length} of the map's ${linked.objects.length} objects are not the linked ones: ${shown}${problems.length > 5 ? '; ...' : ''}` };
  }
  return { id, ok: true, detail: `the map's ${linked.objects.length} objects match; ${linked.archiveMembers.length} archive members are outside ${d.objectsDir}` };
}

/** The objdiff-cli check: a binary found, and its version line equal to the pinned one. */
export function objdiffCheck(found: ObjdiffLocation | undefined, version: string | null, pinned: string | null): DoctorCheck {
  const id = 'toolchain.objdiff';
  if (pinned === null) return { id, ok: false, detail: `${OBJDIFF_VERSION_FILE} is missing or empty` };
  if (found === undefined) return { id, ok: false, detail: `objdiff-cli is missing: set ${OBJDIFF_ENV} to the '${pinned}' binary, or build it into bench/.local/objdiff-target (docs/benchmark-roms.md)` };
  if (version === null) return { id, ok: false, detail: `${found.bin} (${found.source === 'env' ? OBJDIFF_ENV : found.source}) does not run or prints no version; ${OBJDIFF_VERSION_FILE} pins '${pinned}'` };
  if (version !== pinned) return { id, ok: false, detail: `${found.bin} is '${version}', ${OBJDIFF_VERSION_FILE} pins '${pinned}'; set ${OBJDIFF_ENV} to the pinned binary` };
  return { id, ok: true, detail: `${found.bin} ${version}` };
}

export interface DoctorRealOptions {
  /** The environment objdiff-cli is looked up in; default process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function doctorReal(cx: BenchContext, options: DoctorRealOptions = {}): Promise<DoctorReport> {
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
    checks.push(await objectsCheck(d, cx.benchRoot));
    checks.push(await linkedObjectsCheck(d, cx.benchRoot));
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
  const mainRepoRoot = await mainRepoRootOf(cx.repoRoot);
  const found = await findObjdiff(options.env ?? process.env, cx.benchRoot, { repoRoot: cx.repoRoot, ...(mainRepoRoot === undefined ? {} : { mainRepoRoot }) });
  checks.push(objdiffCheck(found, found === undefined ? null : await objdiffVersion(found.bin), await readPinnedObjdiffVersion(cx.repoRoot)));
  return { ok: checks.every((c) => c.ok), checks };
}
