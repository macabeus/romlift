// The corpus threshold (architecture §5, D55): when the counts of a corpus run mean that `assemble` agrees with the
// user's `as`. runCorpus (shell/toolchain/corpus.ts) judges its run with it; the corpus driver and the g1 gates read it.
import { specsOf } from '../isa/rows.ts';
import type { CorpusCounts, CorpusOptions } from './types.ts';

/** The fewest cases the Thumb and bl sections must hold: every Thumb halfword; the bl prefixes and sample. */
export const CORPUS_MIN_CASES = 0x10000;

/**
 * Whether a corpus run meets the threshold (roadmap "Phase 1 exit"): nothing disagrees with `as` (bytes, encoder,
 * context), the Thumb and bl sections hold at least CORPUS_MIN_CASES cases, the ARM section at least its sample, every
 * ARM row has a coverage entry, both alignments were checked and at least one offset extreme.
 */
export function corpusOk(counts: CorpusCounts, options: CorpusOptions): boolean {
  const { thumb, bl, arm } = counts.sections;
  return (
    thumb.disagree === 0 &&
    bl.disagree === 0 &&
    arm.disagree === 0 &&
    counts.encoderAgrees.disagree === 0 &&
    counts.context.disagree === 0 &&
    thumb.cases >= CORPUS_MIN_CASES &&
    bl.cases >= CORPUS_MIN_CASES &&
    arm.cases >= options.armSample &&
    specsOf('arm').every((spec) => arm.coverage[spec.id] !== undefined) &&
    counts.context.alignments.includes('0-mod-4') &&
    counts.context.alignments.includes('2-mod-4') &&
    counts.context.extremes > 0
  );
}
