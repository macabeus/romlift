// One ROM's row of bench/results.json: the proof of concept's row fields (architecture §8.2), less
// the volatile seconds and the signatures (judged from phase 6) and with `scaffold` reduced to its
// verdict.
import type { MissReason, Origin } from 'romlift';

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
  readonly extents: { readonly sized: number; readonly agree: number; readonly mismatches: readonly ExtentRow[] };
  readonly codeEnd: { readonly found: string; readonly elf: string; readonly delta: number };
  readonly deterministic: boolean;
  readonly scaffold: { readonly ok: boolean };
}
