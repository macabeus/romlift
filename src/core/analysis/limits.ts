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
  /** Candidates one grow round may propose before W_CANDIDATE_BUDGET. */
  readonly candidateBudget: number;
}

export const LIMITS: AnalysisLimits = { settleRounds: 600, fixpointRounds: 10_000, candidateBudget: 1_000_000 };

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

/** W_CANDIDATE_BUDGET for a grow round that proposed `count` candidates. */
export function candidateBudget(round: number, count: number, budget: number): Diagnostic<AnalysisCode> {
  return diagnostic(AnalysisCodes, 'W_CANDIDATE_BUDGET', `grow round ${round} proposed ${count} candidates, over the budget of ${budget}`);
}
