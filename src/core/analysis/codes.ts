// Diagnostic codes raised by core/analysis (architecture §9.1, D45). W_PROFILE_MISFIT and
// W_UNDECODED_GAP land with their first raisers, the profile's misfit threshold with W_PROFILE_MISFIT (D59).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const AnalysisCodes = defineCodes({
  W_SETTLE_LIMIT: {
    severity: 'warning',
    meaning: "a function's bl verdicts did not settle within the settle round limit; its last reading is kept",
  },
  W_FIXPOINT_LIMIT: {
    severity: 'warning',
    meaning: 'a grow or gap pass did not reach its fixpoint within the round limit; what was accepted is returned',
  },
  W_CANDIDATE_BUDGET: {
    severity: 'warning',
    meaning: 'one grow round proposed more candidates than the candidate budget',
  },
  W_LISTED_INVALID: {
    severity: 'warning',
    meaning: 'a function the project lists fails a validity rule; it is kept as listed',
  },
  W_UNLISTED_FUNCTION: {
    severity: 'warning',
    meaning: 'discovery accepted a function the project does not list; it is reported and claims nothing',
  },
  E_ANALYSIS_JSON: {
    severity: 'error',
    meaning: 'a romlift/analysis@1 document is not JSON or does not match the schema',
  },
});

export type AnalysisCode = keyof typeof AnalysisCodes;
