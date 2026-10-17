// Where the bench reads and writes: the repository, the benchmark checkouts and the PoC checkout,
// from ROMLIFT_BENCH_ROOT and ROMLIFT_POC or their defaults (AGENTS.md). Every command takes a
// BenchContext, so the tests run the commands against temporary directories.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BenchContext {
  /** The romlift repository root. */
  readonly repoRoot: string;
  /** Where the benchmark checkouts live; dataset paths resolve against it. */
  readonly benchRoot: string;
  /** The read-only proof-of-concept checkout. */
  readonly pocRoot: string;
}

/** The repository that holds this file (bench/src/context.ts). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The context from the environment, with the documented defaults. */
export function contextFromEnv(env: Readonly<Record<string, string | undefined>>, repoRoot: string = REPO_ROOT): BenchContext {
  const bench = env['ROMLIFT_BENCH_ROOT'];
  const benchRoot = bench ? resolve(repoRoot, bench) : dirname(repoRoot);
  const poc = env['ROMLIFT_POC'];
  const pocRoot = poc ? resolve(repoRoot, poc) : join(benchRoot, 'romlift-poc');
  return { repoRoot, benchRoot, pocRoot };
}

/** The committed artifact (architecture §8.2). */
export const resultsPath = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'results.json');
/** The volatile values of a run: wall times, generatedAt, the machine (gitignored). */
export const timingsPath = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'timings.json');
export const datasetDir = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'dataset', 'real');
export const baselineDir = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'baseline');
export const gatesDir = (cx: BenchContext): string => join(cx.repoRoot, 'test', 'gates');
/** The PoC dump of one ROM, written by export-poc (gitignored). */
export const scoredPath = (cx: BenchContext, rom: string): string => join(cx.repoRoot, 'bench', '.local', 'poc', rom, 'scored.json');
/** The as round-trip corpus summary, written by `npm run corpus` (gitignored). */
export const corpusSummaryPath = (cx: BenchContext): string => join(cx.repoRoot, 'bench', '.local', 'corpus', 'summary.json');
