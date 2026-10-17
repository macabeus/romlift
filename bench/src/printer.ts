// The printer family (architecture §8.4, live from phase 1): the as round-trip corpus summary that
// `npm run corpus` writes to bench/.local/corpus/summary.json (schema romlift/corpus-summary@1).
// results.json carries it only while it is current: its `inputsDigest` must equal the digest of the
// corpus inputs computed here (the ISA and assembler-dialect sources, the corpus generator, and the
// `as --version` line). The corpus writer is expected to record the same digest.
import { join } from 'node:path';

import { corpusSummaryPath, type BenchContext } from './context.ts';
import { digestOf, type DigestFile } from './digest.ts';
import { exists, isDirectory, isRecord, listFiles, readFileBytes, readJson } from './files.ts';

export const CORPUS_SUMMARY_SCHEMA = 'romlift/corpus-summary@1';
export const CORPUS_INPUT_DIRS: readonly string[] = ['src/foundation/isa', 'src/foundation/asm', 'test/corpus'];

/** sha256 over the corpus input files (`path\0bytes`, sorted) and the `as` version line. */
export async function corpusInputsDigest(repoRoot: string, asVersion: string | null): Promise<string> {
  const files: DigestFile[] = [];
  for (const dir of CORPUS_INPUT_DIRS) {
    if (!(await isDirectory(join(repoRoot, dir)))) continue;
    for (const file of await listFiles(join(repoRoot, dir))) files.push({ path: `${dir}/${file}`, bytes: await readFileBytes(join(repoRoot, dir, file)) });
  }
  files.push({ path: 'as --version', bytes: new TextEncoder().encode(asVersion ?? '') });
  return digestOf(files, 0);
}

/** The corpus summary when it exists, has the schema and is current; undefined otherwise. */
export async function currentPrinterSummary(cx: BenchContext, asVersion: string | null): Promise<unknown> {
  const path = corpusSummaryPath(cx);
  if (!(await exists(path))) return undefined;
  const summary = await readJson(path);
  if (!isRecord(summary) || summary['schema'] !== CORPUS_SUMMARY_SCHEMA) return undefined;
  return summary['inputsDigest'] === (await corpusInputsDigest(cx.repoRoot, asVersion)) ? summary : undefined;
}
