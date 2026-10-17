// One ROM's row of bench/results.json: the proof of concept's row fields (architecture §8.2), less
// the volatile seconds and the signatures (judged from phase 6) and with `scaffold` reduced to its
// verdict, plus the phase-2 fields the gates read when romlift's own analysis is scored (D24): the
// analysis digest, the PoC baseline's true positives, the dataset rows the run no longer needs, the
// extents that stopped agreeing, and the diff of the rows against the PoC baseline. A row rescored from
// a PoC dump (poc-check) carries none of the phase-2 fields, so it stays comparable with the baseline.
import type { MissReason, Origin } from 'romlift';

import type { ListName } from './dataset.ts';
import type { ExceptionCategory } from './vocabulary.ts';

export interface MissRow {
  readonly addr: string;
  readonly name: string;
  readonly size: number;
  readonly reason: MissReason;
  readonly listed: boolean;
  readonly category?: ExceptionCategory;
}

export interface FalseRow {
  readonly addr: string;
  readonly origin: Origin;
  readonly size: number;
  /** The ELF function whose extent contains the false entry. */
  readonly owner?: string;
  readonly listed: boolean;
  readonly category?: ExceptionCategory;
}

export interface ExtentRow {
  readonly addr: string;
  readonly name: string;
  readonly elf: number;
  readonly found: number;
}

/** A dataset row the run no longer needs (architecture §8.3, `stale-exception`). */
export interface StaleException {
  readonly list: ListName;
  readonly addr: string;
}

/**
 * One row that differs from the PoC baseline (architecture §4.5). The improvements are 'miss-removed',
 * 'false-entry-removed' and 'extent-agrees'; every other kind is a change (baseline-rows.ts).
 */
export interface RowDiff {
  readonly kind: string;
  readonly addr: string;
}

export interface BaselineRows {
  /** Every row that differs from bench/baseline/poc-2026-10-16.json. */
  readonly diffs: readonly RowDiff[];
  /** The diffs bench/baseline/accepted-diffs.json does not list. */
  readonly unaccepted: readonly RowDiff[];
  /** Listed improvements that no longer differ from the baseline. */
  readonly staleAccepted: readonly RowDiff[];
}

/** The parity digest of a romlift run and the PoC's committed one (bench/baseline/poc-digests.json; '' when it holds none). */
export interface RowParity {
  readonly digest: string;
  readonly expected: string;
}

export interface BenchRow {
  readonly name: string;
  readonly sha1: string;
  readonly elfCommit: string | null;
  /** ELF functions from the end of the startup region on. */
  readonly elfFunctions: number;
  /** Functions found from the end of the startup region on. */
  readonly entries: number;
  readonly startup: { readonly end: string; readonly pieces: number; readonly elfFunctions: number };
  readonly thumb: number;
  readonly arm: number;
  readonly tp: number;
  readonly precision: number;
  readonly recall: number;
  readonly misses: readonly MissRow[];
  readonly falseEntries: readonly FalseRow[];
  readonly extents: {
    readonly sized: number;
    readonly agree: number;
    readonly mismatches: readonly ExtentRow[];
    /** Agreeing in the PoC baseline, not agreeing now (romlift rows only). */
    readonly lost?: readonly ExtentRow[];
  };
  readonly codeEnd: { readonly found: string; readonly elf: string; readonly delta: number };
  readonly deterministic: boolean;
  /** The PoC's scaffold verdict (from its dump until phase 3); absent when no dump was read. */
  readonly scaffold?: { readonly ok: boolean };
  /** sha256 of the canonical JSON of the analysis (romlift rows only). */
  readonly analysisDigest?: string;
  /** The PoC baseline's true positives (romlift rows only). */
  readonly poc?: { readonly tp: number };
  readonly staleExceptions?: readonly StaleException[];
  readonly baselineRows?: BaselineRows;
  /** The parity digest of the run against the PoC's (romlift rows only; g2.poc-parity). */
  readonly parity?: RowParity;
}

/** The row of a scored romlift run: every phase-2 field present (what `bench run --json` prints). */
export type RomliftRow = BenchRow & {
  readonly extents: BenchRow['extents'] & { readonly lost: readonly ExtentRow[] };
  readonly analysisDigest: string;
  readonly poc: { readonly tp: number };
  readonly staleExceptions: readonly StaleException[];
  readonly baselineRows: BaselineRows;
  readonly parity: RowParity;
};
