// The printer family (architecture §8.4, live from phase 1): the as round-trip corpus summary that
// `npm run corpus` writes to bench/.local/corpus/summary.json (schema romlift/corpus-summary@1).
// results.json carries it only while it is current: its `inputsDigest` must equal romlift's
// corpusInputsDigest (romlift/internal, D55), the one definition the corpus driver also writes with,
// so the two can never disagree.
import { corpusInputsDigest, parseCorpusSummary } from 'romlift/internal';
import type { CorpusSummary } from 'romlift/internal';

import { corpusSummaryPath, type BenchContext } from './context.ts';
import { exists, readJson } from './files.ts';

/** Whether a summary was made with this `as` and its inputs digest is the corpus's current one. */
async function isCurrent(cx: BenchContext, summary: CorpusSummary, asVersion: string): Promise<boolean> {
  if (summary.as !== asVersion) return false;
  return summary.inputsDigest === (await corpusInputsDigest(cx.repoRoot, asVersion, summary.options));
}

/** The corpus summary when it exists, has the schema, matches `as` and is current; undefined otherwise. */
export async function currentPrinterSummary(cx: BenchContext, asVersion: string | null): Promise<CorpusSummary | undefined> {
  if (asVersion === null) return undefined;
  const path = corpusSummaryPath(cx);
  if (!(await exists(path))) return undefined;
  const parsed = parseCorpusSummary(await readJson(path));
  if (!parsed.ok) return undefined;
  return (await isCurrent(cx, parsed.value, asVersion)) ? parsed.value : undefined;
}

/** What a writing run records as the printer member, or why it must not write. */
export type PrinterMember =
  | { readonly ok: true; readonly summary: CorpusSummary | undefined; readonly from: 'corpus' | 'previous' | 'none' }
  | { readonly ok: false; readonly reason: string };

/**
 * The printer member of the artifact a writing run records. The local corpus summary when it is
 * current; otherwise the previous artifact's member while it is still current (its inputs digest is
 * recomputed from the source tree, so no corpus run is needed); otherwise nothing, but only when the
 * previous artifact had no member either. A run never drops a member silently: when the previous one
 * is stale and no current summary exists, the caller refuses to write.
 */
export async function printerMember(cx: BenchContext, asVersion: string | null, previous: CorpusSummary | undefined): Promise<PrinterMember> {
  const local = await currentPrinterSummary(cx, asVersion);
  if (local !== undefined) return { ok: true, summary: local, from: 'corpus' };
  if (previous === undefined) return { ok: true, summary: undefined, from: 'none' };
  if (asVersion !== null && (await isCurrent(cx, previous, asVersion))) return { ok: true, summary: previous, from: 'previous' };
  const why = asVersion === null ? 'no arm-none-eabi-as is on the PATH' : 'its corpus inputs or as version changed';
  return { ok: false, reason: `the printer member of bench/results.json is no longer current (${why}) and bench/.local/corpus/summary.json is missing or stale: run \`npm run corpus\` first` };
}
