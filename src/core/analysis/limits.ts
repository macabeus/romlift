// Safety bounds of the driver that are not compiler knowledge (architecture §4.2, D12). Reaching one
// raises a warning and keeps what was computed; it never throws.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { AnalysisCodes } from './codes.ts';
import type { AnalysisCode } from './codes.ts';

export interface AnalysisLimits {
  /** Rounds of one function's bl fixpoint (the PoC's cap of 600). */
  readonly settleRounds: number;
  /** Rounds of grow, and of each pass's grow + fillGaps loop. */
  readonly fixpointRounds: number;
  /**
   * Distinct harvest targets grow judges in one run (D59 m): past it a fresh target is not judged and
   * W_CANDIDATE_BUDGET is raised once, while targets judged before are judged again as usual. It bounds
   * the rejections and validity verdicts a flood of pointers leaves, whatever the number of grow rounds.
   * The six tuning ROMs judge at most 13,423 distinct targets in a run (pokeemerald; fe7j 10,515, tmc
   * 9,673, sa3 4,080, sa2 3,087, klonoa 804; measured on 18 October 2026, tmc included).
   */
  readonly candidateBudget: number;
  /**
   * Instructions one walk may record: a walk that reaches it stops with a 'walk-limit' error (W_WALK_LIMIT),
   * which bounds the memory a reading holds when a candidate runs over megabytes of zeros. The largest
   * accepted reading of the six tuning ROMs has 11,570 instructions (klonoa; fe7j 4,109, pokeemerald
   * 2,518, sa3 1,653, sa2 1,333, tmc 1,129; measured on 18 October 2026, tmc included).
   */
  readonly walkInsns: number;
  /**
   * Consecutive all-zero instructions one path may run over (`movs r0, r0`, `andeq r0, r0, r0`): a path
   * that runs further stops with a 'zero-run' error, so a candidate in a zero-filled region costs a few
   * instructions instead of the whole region. No accepted reading of the six tuning ROMs holds even one
   * all-zero instruction (measured on 18 October 2026, tmc included); it raises no
   * diagnostic, because the bytes are not code (like an undecodable halfword).
   */
  readonly zeroRun: number;
  /**
   * Estimated bytes of the candidate readings one epoch may hold (readings of entries not accepted, kept
   * so a reading is computed once per epoch, D13). Past it the held readings are dropped, their validity
   * verdicts staying memoised, and W_READING_BUDGET is raised: a dropped reading asked for again is walked
   * again. It bounds the memory of a grow round over a flood of candidates (D59 m). By this estimate the
   * six tuning ROMs hold at most 208,344,064 bytes in one epoch (pokeemerald, 78% of the budget; fe7j
   * 120.0 MB, tmc 112.8 MB, sa3 102.6 MB, sa2 90.4 MB, klonoa 18.5 MB; measured on 18 October 2026, tmc
   * included), so none reaches it, but pokeemerald is within a quarter of it.
   */
  readonly epochReadingBytes: number;
}

export const LIMITS: AnalysisLimits = { settleRounds: 600, fixpointRounds: 10_000, candidateBudget: 262_144, walkInsns: 65_536, zeroRun: 64, epochReadingBytes: 256 * 1024 * 1024 };

/** W_SETTLE_LIMIT for the function at `entry`. */
export function settleLimit(entry: Addr, rounds: number): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_SETTLE_LIMIT', `the bl verdicts of ${hexAddr(entry)} did not settle in ${rounds} rounds; the last reading is kept`, {
    addr: entry,
  });
}

/** W_FIXPOINT_LIMIT for the loop named `loop`. */
export function fixpointLimit(loop: string, rounds: number): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_FIXPOINT_LIMIT', `${loop} did not reach its fixpoint in ${rounds} rounds; what was accepted is kept`);
}

/** W_WALK_LIMIT for the walk of `entry` in `mode`. */
export function walkLimit(entry: Addr, mode: 'thumb' | 'arm', at: Addr): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_WALK_LIMIT', `the ${mode} walk of ${hexAddr(entry)} reached the walk limit at ${hexAddr(at)}; it is not code`, { addr: entry });
}

/** W_READING_BUDGET: the readings held in one epoch passed `budget` bytes and were dropped. */
export function readingBudget(round: number, budget: number): Diagnostic<AnalysisCode> {
  return diagnostic(
    AnalysisCodes,
    'W_READING_BUDGET',
    `round ${round} held candidate readings past the budget of ${budget} bytes; they were dropped and are walked again when asked for`,
  );
}

/** W_CANDIDATE_BUDGET: from grow round `round` on, fresh targets past the run's budget of `budget` were not judged. */
export function candidateBudget(round: number, budget: number): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_CANDIDATE_BUDGET', `the run judged ${budget} distinct candidates, its budget; from grow round ${round} on, fresh candidates were not judged`);
}
