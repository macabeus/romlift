// The source digest (architecture §8.6, D27): sha256 over every input of a verdict — the product
// sources, signature specs, templates, the bench, its datasets and baselines, the gate tests and the
// package and compiler settings — plus the Node major version. Files are taken in code-unit order of
// their repository-relative path, each hashed as `path\0` then its bytes, and the major is appended
// as `node\0<major>`. A missing directory contributes nothing.
import { join } from 'node:path';
import { compareCodeUnits } from 'romlift';
import { listDir, sha256Stream } from 'romlift/node';

import { BenchError, isDirectory, listFiles, readFileBytes } from './files.ts';

export const SOURCE_DIRS: readonly string[] = [
  'src',
  'signatures/specs',
  'templates',
  'bench/src',
  'bench/tools',
  'bench/dataset',
  'bench/baseline',
  'test/gates',
  'test/corpus',
];
export const SOURCE_FILES: readonly string[] = ['package.json', 'package-lock.json'];
const TSCONFIG = /^tsconfig[^/]*\.json$/;

export interface DigestFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The digest of `files` (any order) and `nodeMajor`. */
export function digestOf(files: readonly DigestFile[], nodeMajor: number): string {
  const sorted = [...files].sort((a, b) => compareCodeUnits(a.path, b.path));
  function* chunks(): Generator<string | Uint8Array> {
    for (const f of sorted) {
      yield `${f.path}\0`;
      yield f.bytes;
    }
    yield `node\0${nodeMajor}`;
  }
  return sha256Stream(chunks());
}

/** The repository-relative paths the source digest covers, sorted. */
export async function sourceDigestPaths(repoRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const dir of SOURCE_DIRS) {
    if (!(await isDirectory(join(repoRoot, dir)))) continue;
    for (const file of await listFiles(join(repoRoot, dir))) paths.push(`${dir}/${file}`);
  }
  const top = await listDir(repoRoot);
  if (!top.ok) throw new BenchError(top.diagnostic.message);
  for (const name of top.value) {
    if ((SOURCE_FILES.includes(name) || TSCONFIG.test(name)) && !(await isDirectory(join(repoRoot, name))))
      paths.push(name);
  }
  return paths.sort(compareCodeUnits);
}

export async function sourceDigest(repoRoot: string, nodeMajor: number): Promise<string> {
  const files: DigestFile[] = [];
  for (const path of await sourceDigestPaths(repoRoot))
    files.push({ path, bytes: await readFileBytes(join(repoRoot, path)) });
  return digestOf(files, nodeMajor);
}

/** The major version of the running Node. */
export function currentNodeMajor(): number {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
}
