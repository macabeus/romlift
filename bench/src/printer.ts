// The printer family (architecture §8.4, live from phase 1): the as round-trip corpus summary that
// `npm run corpus` writes to bench/.local/corpus/summary.json (schema romlift/corpus-summary@1).
// results.json carries it only while it is current: its `inputsDigest` must equal romlift's
// corpusInputsDigest (romlift/internal, D55), the one definition the corpus driver also writes with,
// so the two can never disagree.
import { corpusInputsDigest, parseCorpusSummary } from 'romlift/internal';
import type { CorpusSummary } from 'romlift/internal';

import { corpusSummaryPath, type BenchContext } from './context.ts';
import { exists, readJson } from './files.ts';

/** The corpus summary when it exists, has the schema, matches `as` and is current; undefined otherwise. */
export async function currentPrinterSummary(cx: BenchContext, asVersion: string | null): Promise<CorpusSummary | undefined> {
  if (asVersion === null) return undefined;
  const path = corpusSummaryPath(cx);
  if (!(await exists(path))) return undefined;
  const parsed = parseCorpusSummary(await readJson(path));
  if (!parsed.ok || parsed.value.as !== asVersion) return undefined;
  const summary = parsed.value;
  return summary.inputsDigest === (await corpusInputsDigest(cx.repoRoot, asVersion, summary.options)) ? summary : undefined;
}
