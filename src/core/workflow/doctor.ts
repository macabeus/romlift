// The doctor's policy (architecture §2.1, D55): which checks `romlift doctor` reports, which must be ok,
// when the corpus counts meet the threshold, and the one verdict the CLI turns into an exit code. Pure:
// the shell runs the tools and the corpus and calls these functions; it decides nothing itself, and
// the CLI maps the verdict without re-reading the statuses.
import type { CorpusCounts, CorpusOptions } from '../../foundation/corpus/types.ts';
import { specsOf } from '../../foundation/isa/rows.ts';

export type DoctorCheckId = 'binutils' | 'corpus' | 'thumb-jump11' | 'agbcc' | 'old_agbcc';
export type DoctorStatus = 'ok' | 'missing' | 'fail';

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly detail: string;
}

/** The checks of every report, in report order. */
export const DOCTOR_CHECK_IDS: readonly DoctorCheckId[] = ['binutils', 'corpus', 'thumb-jump11', 'agbcc', 'old_agbcc'];

/** The checks that must be ok for the toolchain to build a romlift project; agbcc and old_agbcc are only reported. */
export const DOCTOR_REQUIRED: readonly DoctorCheckId[] = ['binutils', 'corpus', 'thumb-jump11'];

/** The fewest cases the Thumb and bl sections must hold: every Thumb halfword; the bl prefixes and sample. */
export const CORPUS_MIN_CASES = 0x10000;

/**
 * Whether a corpus run meets the phase-1 threshold (roadmap "Phase 1 exit"): nothing disagrees with
 * `as` (bytes, encoder, context), the Thumb and bl sections hold at least CORPUS_MIN_CASES cases, the
 * ARM section at least its sample, every ARM row has a coverage entry, both alignments were checked
 * and at least one offset extreme.
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

/**
 * The verdict of a report: `ok` when every required check is ok; `unusable` when the binutils are
 * missing or cannot run (nothing else could be measured); `disagrees` when the binutils run but the
 * corpus or the JUMP11 probe fails.
 */
export type DoctorVerdict = 'ok' | 'unusable' | 'disagrees';

export function doctorVerdict(checks: readonly DoctorCheck[]): DoctorVerdict {
  const status = (id: DoctorCheckId): DoctorStatus | undefined => checks.find((c) => c.id === id)?.status;
  if (status('binutils') !== 'ok') return 'unusable';
  return DOCTOR_REQUIRED.every((id) => status(id) === 'ok') ? 'ok' : 'disagrees';
}
