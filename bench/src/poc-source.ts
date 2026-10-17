// The PoC pinned by content (architecture §4.5, D50): the sha256 of every file under its src/,
// signatures/ and bench/dataset/ and of its package-lock.json, plus one digest over the sorted
// `path\0sha256\n` list. bench/baseline/poc-source.json holds the pinned value; export-poc,
// doctor-real and poc-check refuse a checkout that differs from it.
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';
import { sha256Of } from 'romlift/node';

import { baselineDir, type BenchContext } from './context.ts';
import { BenchError, exists, isDirectory, isRecord, listFiles, readFileBytes, readJson } from './files.ts';

export const POC_SOURCE_DIRS: readonly string[] = ['src', 'signatures', 'bench/dataset'];
export const POC_SOURCE_FILES: readonly string[] = ['package-lock.json'];

export interface PocSource {
  /** PoC-relative path to the sha256 of its bytes, in code-unit order. */
  readonly files: Readonly<Record<string, string>>;
  readonly digest: string;
}

/** sha256 over `path\0sha256\n` for every file, sorted by path. */
export function pocSourceDigest(files: Readonly<Record<string, string>>): string {
  const lines = Object.keys(files)
    .sort(compareCodeUnits)
    .map((path) => `${path}\0${files[path] ?? ''}\n`);
  return sha256Of(lines.join(''));
}

/** The digests of the checkout at `pocRoot`, as poc-source.json records them. */
export async function computePocSource(pocRoot: string): Promise<PocSource> {
  if (!(await isDirectory(pocRoot))) throw new BenchError(`the PoC checkout ${pocRoot} is missing (set ROMLIFT_POC)`);
  const paths: string[] = [];
  for (const dir of POC_SOURCE_DIRS) {
    if (!(await isDirectory(join(pocRoot, dir)))) continue;
    for (const file of await listFiles(join(pocRoot, dir))) paths.push(`${dir}/${file}`);
  }
  for (const file of POC_SOURCE_FILES) if (await exists(join(pocRoot, file))) paths.push(file);
  const files: Record<string, string> = {};
  for (const path of paths.sort(compareCodeUnits)) files[path] = sha256Of(await readFileBytes(join(pocRoot, path)));
  return { files, digest: pocSourceDigest(files) };
}

export function parsePocSource(value: unknown, where: string): PocSource {
  if (!isRecord(value) || !isRecord(value['files']) || typeof value['digest'] !== 'string') {
    throw new BenchError(`${where}: expected {"files": {path: sha256}, "digest": sha256}`);
  }
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(value['files'])) {
    if (typeof digest !== 'string') throw new BenchError(`${where}: the digest of ${path} is not a string`);
    files[path] = digest;
  }
  return { files, digest: value['digest'] };
}

export const pocSourcePath = (cx: BenchContext): string => join(baselineDir(cx), 'poc-source.json');

export async function readPinnedPocSource(cx: BenchContext): Promise<PocSource> {
  const path = pocSourcePath(cx);
  return parsePocSource(await readJson(path), path);
}

/** Every way `actual` differs from `pinned`: missing, changed and extra files, and the digest. */
export function comparePocSource(pinned: PocSource, actual: PocSource): string[] {
  const problems: string[] = [];
  const paths = new Set([...Object.keys(pinned.files), ...Object.keys(actual.files)]);
  for (const path of Array.from(paths).sort(compareCodeUnits)) {
    const want = pinned.files[path];
    const have = actual.files[path];
    if (have === undefined) problems.push(`${path} is missing from the PoC checkout`);
    else if (want === undefined) problems.push(`${path} is not in the pinned PoC source`);
    else if (want !== have) problems.push(`${path} differs from the pinned PoC source`);
  }
  if (pocSourceDigest(pinned.files) !== pinned.digest) problems.push('poc-source.json: its digest does not match its file list');
  return problems;
}
