// The signature matcher's numbers and the order of its placement rules (architecture §7.2, D7, D12): every constant
// match.ts, resolve.ts and the sig.* rules read lives here, never inline. The values are the PoC's
// (romlift-poc/src/signatures/apply.ts: FREE_MIN, WINDOW, TOLERATED_WORDS, NEAR, the 256 candidates and the 32 bytes
// of step 4); the stages are its steps 1, 2, 3 with 4, and 3b.
import type { SignatureRuleId } from './schema.ts';

/**
 * One stage of the matcher: its rules, tried in this order on each member a stage visits (the first that places it
 * wins), and whether the stage repeats until it places nothing more. Every rule of a stage visits members the same
 * way (its `sweep`, rules/state.ts).
 */
export interface SignatureStage {
  readonly rules: readonly SignatureRuleId[];
  readonly repeat: boolean;
}

/**
 * The placement rules in strength order, as the matcher runs them: the PoC's step 1 (unique fits, largest first),
 * step 2 (link-order runs), steps 3 and 4 interleaved per member until nothing changes (spacing from a placed
 * neighbour, else both neighbours pinning it with a few differing words), then step 3b (the short member's window).
 */
export const SIGNATURE_RULE_ORDER: readonly SignatureStage[] = [
  { rules: ['sig.unique-fit'], repeat: false },
  { rules: ['sig.link-order-run'], repeat: false },
  { rules: ['sig.neighbour-spacing', 'sig.pinned-both-sides'], repeat: true },
  { rules: ['sig.short-member-window'], repeat: true },
];

export interface SignaturePolicy {
  /** The stages the matcher runs, in order (SIGNATURE_RULE_ORDER); a rule left out of every stage never places. */
  readonly stages: readonly SignatureStage[];
  /** Unmasked bytes a member, or a contiguous run of members, needs to stand on its own (the PoC's FREE_MIN). */
  readonly minUnmaskedBytes: number;
  /** The most candidate addresses kept per member; the scan stops collecting at this many. */
  readonly candidateCap: number;
  /** How far from a placed neighbour a member may sit when it is the only fit there (the PoC's WINDOW). */
  readonly window: number;
  /** sig.pinned-both-sides: the smallest member it places with differing words. */
  readonly pinnedMinBytes: number;
  /** sig.pinned-both-sides: the most aligned words a pinned member may differ in (the PoC's TOLERATED_WORDS). */
  readonly maxDiffWords: number;
  /** resolve.ts: placements of one library and kind this close (bytes from the end of the last) form one region. */
  readonly moduleNear: number;
}

export const SIGNATURE_POLICY: SignaturePolicy = {
  stages: SIGNATURE_RULE_ORDER,
  minUnmaskedBytes: 12,
  candidateCap: 256,
  window: 64,
  pinnedMinBytes: 32,
  maxDiffWords: 2,
  moduleNear: 256,
};
