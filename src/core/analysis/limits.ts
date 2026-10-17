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
   * Candidates one grow round judges: past it the rest of the round's snapshot is not judged and
   * W_CANDIDATE_BUDGET is raised, which bounds the rejections and verdicts a flood of pointers leaves
   * (correctness-r1-4). The five tuning ROMs propose at most 13,612 in a round (pokeemerald).
   */
  readonly candidateBudget: number;
  /**
   * Instructions one walk may record: a walk that reaches it stops with a 'walk-limit' error (W_WALK_LIMIT),
   * which bounds the memory a reading holds when a candidate runs over megabytes of zeros. The largest
   * function of the five tuning ROMs has about 12,000 instructions (klonoa).
   */
  readonly walkInsns: number;
  /**
   * Consecutive all-zero instructions one path may run over (`movs r0, r0`, `andeq r0, r0, r0`): a path
   * that runs further stops with a 'zero-run' error, so a candidate in a zero-filled region costs a few
   * instructions instead of the whole region. No code of the five tuning ROMs comes close; it raises no
   * diagnostic, because the bytes are not code (like an undecodable halfword).
   */
  readonly zeroRun: number;
  /**
   * Estimated bytes of the candidate readings one epoch may hold (readings of entries not accepted, kept
   * so a reading is computed once per epoch, D13). Past it the held readings are dropped, their validity
   * verdicts staying memoised, and W_READING_BUDGET is raised: a dropped reading asked for again is walked
   * again. It bounds the memory of a grow round over a flood of candidates (correctness-r1-4). The five
   * tuning ROMs hold at most about 105 MB by this estimate (fe7j, pokeemerald), so they never reach it.
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

/** W_CANDIDATE_BUDGET for a grow round that proposed `count` candidates. */
export function candidateBudget(round: number, count: number, budget: number): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_CANDIDATE_BUDGET', `grow round ${round} proposed ${count} candidates, over the budget of ${budget}; only the first ${budget} were judged`);
}
