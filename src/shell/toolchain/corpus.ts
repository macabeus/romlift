// runCorpus (architecture §5, D55): assembles every file of the round-trip corpus with the user's
// arm-none-eabi-as, compares the bytes case by case and returns the counts with their verdict. Both
// `romlift doctor` and the corpus driver (`npm run corpus`) run it; the driver persists the files
// through `onFile` and writes the summary. At most `limit` assemblers run at once; file order is kept.
import { availableParallelism } from 'node:os';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { armCoverage, compareCorpusFile, corpusFiles, summarizeCorpus } from '../../foundation/corpus/corpus.ts';
import type { CorpusAssembly, CorpusComparison, CorpusCounts, CorpusFile, CorpusOptions } from '../../foundation/corpus/corpus.ts';
import { corpusOk } from '../../core/workflow/doctor.ts';
import { assembleWithBinutils } from './binutils.ts';
import type { AssembleResult, Binutils } from './binutils.ts';

export interface CorpusRunOptions {
  readonly options: CorpusOptions;
  readonly tools: Binutils;
  /** The most assemblers running at once; default max(2, availableParallelism()). */
  readonly limit?: number;
  /** Called with each file before it is assembled (the driver writes it to disk). */
  readonly onFile?: (file: CorpusFile) => Promise<void>;
}

export interface CorpusRun {
  readonly counts: CorpusCounts;
  /** corpusOk(counts, options): the threshold of core/workflow/doctor.ts. */
  readonly ok: boolean;
}

/** The comparator's view of an assembly: the bytes, or the assembler's error text (its diagnostics when it printed nothing). */
function assembly(result: AssembleResult): CorpusAssembly {
  if (result.ok) return { ok: true, bytes: result.bytes };
  return { ok: false, stderr: result.stderr === '' ? result.diagnostics.map((d) => d.message).join('\n') : result.stderr };
}

/** Assembles and compares every corpus file of `run.options`. */
export async function runCorpus(run: CorpusRunOptions): Promise<CorpusRun> {
  const limit = run.limit ?? Math.max(2, availableParallelism());
  const results: CorpusComparison[] = [];
  const running = new Set<Promise<void>>();
  let index = 0;
  for (const file of corpusFiles(run.options)) {
    const at = index++;
    if (run.onFile !== undefined) await run.onFile(file);
    const task = assembleWithBinutils(file.text, { mode: file.mode, tools: run.tools, files: { 'include/macros.inc': DIALECT.macrosInc } }).then((result) => {
      results[at] = compareCorpusFile(file, assembly(result));
    });
    const tracked: Promise<void> = task.finally(() => running.delete(tracked));
    running.add(tracked);
    if (running.size >= limit) await Promise.race(running);
  }
  await Promise.all(running);
  const counts = summarizeCorpus(results, armCoverage());
  return { counts, ok: corpusOk(counts, run.options) };
}
