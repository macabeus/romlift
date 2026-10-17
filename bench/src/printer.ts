// The printer family (architecture §8.4, live from phase 1): the as round-trip corpus summary that
// `npm run corpus` writes to bench/.local/corpus/summary.json (schema romlift/corpus-summary@1).
// results.json carries it only while it is current: its `inputsDigest` must equal the digest of the
// corpus inputs computed here. This file is the one definition of that digest; the corpus driver
// (test/corpus/generate.ts) imports it to write the summary and to decide whether `--reuse` may print a
// cached one, so the two can never disagree.
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';
import { sha256Stream } from 'romlift/node';

import { corpusSummaryPath, type BenchContext } from './context.ts';
import { exists, isDirectory, isRecord, listFiles, readFileBytes, readJson } from './files.ts';

export const CORPUS_SUMMARY_SCHEMA = 'romlift/corpus-summary@1';
/** The corpus inputs: the ISA, the assembler dialect and the corpus driver (repository-relative). */
export const CORPUS_INPUT_DIRS: readonly string[] = ['src/foundation/isa', 'src/foundation/asm', 'test/corpus'];

/**
 * sha256 over the corpus inputs: for every file under CORPUS_INPUT_DIRS in code-unit order of its
 * repository-relative path, `path\0`, its bytes and `\0`; then `as\0<as --version line>\0options\0`
 * and the options as JSON followed by `\0`. The options are the corpus's own (`seed`, `armSample`,
 * `blSample`, in that order), so a corpus generated with a smaller sample has another digest.
 */
export async function corpusInputsDigest(repoRoot: string, asVersion: string, options: unknown): Promise<string> {
  const paths: string[] = [];
  for (const dir of CORPUS_INPUT_DIRS) {
    if (!(await isDirectory(join(repoRoot, dir)))) continue;
    for (const file of await listFiles(join(repoRoot, dir))) paths.push(`${dir}/${file}`);
  }
  paths.sort(compareCodeUnits);
  const chunks: (string | Uint8Array)[] = [];
  for (const path of paths) chunks.push(`${path}\0`, await readFileBytes(join(repoRoot, path)), '\0');
  chunks.push(`as\0${asVersion}\0options\0${JSON.stringify(options)}\0`);
  return sha256Stream(chunks);
}

/** The corpus summary when it exists, has the schema and is current; undefined otherwise. */
export async function currentPrinterSummary(cx: BenchContext, asVersion: string | null): Promise<unknown> {
  if (asVersion === null) return undefined;
  const path = corpusSummaryPath(cx);
  if (!(await exists(path))) return undefined;
  const summary = await readJson(path);
  if (!isRecord(summary) || summary['schema'] !== CORPUS_SUMMARY_SCHEMA) return undefined;
  if (summary['as'] !== asVersion) return undefined;
  return summary['inputsDigest'] === (await corpusInputsDigest(cx.repoRoot, asVersion, summary['options'])) ? summary : undefined;
}
