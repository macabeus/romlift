// What g2.poc-parity still checks once it is historical (gate.ts `historicalCheck`, D60, gate-honesty-r1-3):
// the committed M1 evidence covers every tuning dataset. The gate judged parity for every tuning ROM while
// it ran; a tuning ROM without evidence fails it at landed 1, and freezing the gate at landed 2 must not
// turn that fail into `historical`. A ROM the owner scopes out of the gate is passed in `scopedOut` with
// the decision that did so; no such decision exists yet (phase-2.md, Owner questions, Q1).

/** The committed evidence as far as coverage goes: which ROMs it and poc-digests.json hold. */
export interface ParityCoverage {
  readonly evidenceRoms: readonly string[];
  readonly digestRoms: readonly string[];
}

/** One problem per tuning dataset the evidence does not cover, empty when it covers all of them. */
export function parityCoverageProblems(c: ParityCoverage, tuning: readonly string[], scopedOut: Readonly<Record<string, string>> = {}): string[] {
  const out: string[] = [];
  for (const name of tuning) {
    if (scopedOut[name] !== undefined) continue;
    const missing = [c.evidenceRoms.includes(name) ? undefined : 'parity evidence', c.digestRoms.includes(name) ? undefined : 'committed PoC digest'].filter((x) => x !== undefined);
    if (missing.length > 0) out.push(`${name}: no ${missing.join(' and no ')}`);
  }
  return out;
}

/**
 * Tuning ROMs the owner has scoped out of g2.poc-parity, each with the decision that did so. Empty: Q1 of
 * phase-2.md (may the gate cover only the ROMs of the M1 evidence?) is unanswered.
 */
export const SCOPED_OUT: Readonly<Record<string, string>> = {};
