// The data of the round-trip corpus: options, cases, files, the counts a run produces and the frozen
// summary contract (`romlift/corpus-summary@1`). corpus.ts is the entry point; this file holds what
// every corpus module shares. The corpus holds counts only: whether they meet the phase-1 threshold
// is decided by foundation/corpus/threshold.ts (corpusOk).
import type { SpecId } from '@match-kit/isa/armv4t';

import type { RawReason } from '../isa.ts';
import type { Mode } from '../rom/span.ts';

/** The schema id of the persisted summary. */
export const CORPUS_SUMMARY_SCHEMA = 'romlift/corpus-summary@1';

export interface CorpusOptions {
  /** Seeds the bl sample, the ARM sweep bases and the ARM sample (xorshift32, foundation/util/prng.ts). */
  readonly seed: number;
  readonly armSample: number;
  readonly blSample: number;
}

export const DEFAULT_CORPUS_OPTIONS: CorpusOptions = { seed: 0x2026_1017, armSample: 1 << 20, blSample: 65_536 };

/** The address `corpus_base` stands for. */
export const CORPUS_BASE = 0x0800_0000;

/** Cases per file: small enough for `as` to take quickly, large enough to keep the file count low. */
export const CASES_PER_FILE = 16_384;

export type CorpusSection = 'thumb' | 'bl' | 'arm';
export type Alignment = '0-mod-4' | '2-mod-4';
/** An offset extreme: the range ends, and one step past each (which must not assemble). */
export type Extreme = 'min' | 'max' | 'min-1' | 'max+1';

/** Marks an address-dependent case: a branch, bl, pool load or adr. */
export interface CaseContext {
  readonly alignment: Alignment;
  readonly extreme?: Extreme;
}

export interface CorpusCase {
  /** Byte offset from corpus_base. */
  readonly offset: number;
  readonly word: number;
  readonly size: 2 | 4;
  readonly specId: SpecId;
  /** The printed line (a mnemonic, or the `.inst` fallback). */
  readonly text: string;
  readonly kind: 'mnemonic' | 'raw';
  readonly section: CorpusSection;
  readonly reason?: RawReason;
  /** The word `assemble` gives the printed mnemonic in process. */
  readonly assembled?: number;
  readonly context?: CaseContext;
}

/** A text one step past an offset range: `as` must reject it and `assemble` must give nothing. */
export interface CorpusProbe {
  readonly offset: number;
  readonly section: CorpusSection;
  readonly text: string;
  readonly context: CaseContext;
  /** What `assemble` gives the text in process (undefined: it refuses, as it must). */
  readonly assembled?: number;
}

export interface CorpusFile {
  /** A file name without directory, ending in `.s`. */
  readonly name: string;
  readonly mode: Mode;
  readonly text: string;
  /** The number of bytes `.text` must hold when `expect` is 'bytes'. */
  readonly size: number;
  readonly expect: 'bytes' | 'error';
  readonly cases: readonly CorpusCase[];
  readonly probe?: CorpusProbe;
}

/** The per-row coverage of the ARM sweep: fields swept through every value, and fields only sampled. */
export type ArmCoverage = Readonly<
  Record<string, { readonly exhaustive: readonly string[]; readonly sampled: readonly string[] }>
>;

export interface CorpusExample {
  readonly offset: number;
  readonly word: string;
  readonly text: string;
  readonly expected: string;
  readonly got: string;
}

export interface CorpusSectionSummary {
  readonly cases: number;
  readonly mnemonic: number;
  readonly raw: number;
  readonly agree: number;
  readonly disagree: number;
  readonly rawByReason: Readonly<Record<RawReason, number>>;
  readonly examples: readonly CorpusExample[];
}

/** What comparing every file of a corpus run with `as` counted: per section, the encoder and the context. */
export interface CorpusCounts {
  readonly sections: {
    readonly thumb: CorpusSectionSummary;
    readonly bl: CorpusSectionSummary;
    readonly arm: CorpusSectionSummary & { readonly coverage: ArmCoverage };
  };
  readonly encoderAgrees: {
    readonly checked: number;
    readonly disagree: number;
    readonly examples: readonly CorpusExample[];
  };
  readonly context: {
    readonly checked: number;
    readonly disagree: number;
    readonly alignments: readonly Alignment[];
    readonly extremes: number;
    readonly examples: readonly CorpusExample[];
  };
}

/** The frozen summary contract `romlift/corpus-summary@1`, consumed by the gate files and the bench. */
export interface CorpusSummary extends CorpusCounts {
  readonly schema: typeof CORPUS_SUMMARY_SCHEMA;
  readonly inputsDigest: string;
  readonly as: string;
  readonly options: CorpusOptions;
  /** Whether the counts meet the threshold (foundation/corpus/threshold.ts corpusOk). */
  readonly ok: boolean;
}

/** The persisted summary of a run, keys in contract order. */
export function corpusSummary(
  head: { readonly inputsDigest: string; readonly as: string; readonly options: CorpusOptions },
  counts: CorpusCounts,
  ok: boolean,
): CorpusSummary {
  const { seed, armSample, blSample } = head.options;
  return {
    schema: CORPUS_SUMMARY_SCHEMA,
    inputsDigest: head.inputsDigest,
    as: head.as,
    options: { seed, armSample, blSample },
    sections: counts.sections,
    encoderAgrees: counts.encoderAgrees,
    context: counts.context,
    ok,
  };
}

/** A raw count of 0 for every RawReason, in RAW_REASONS order (a new reason fails the typecheck here). */
export function zeroRawCounts(): Record<RawReason, number> {
  return { undefined: 0, unpredictable: 0, 'sbz-set': 0, 'as-alias': 0, 'no-roundtrip': 0 };
}

/** What assembling one corpus file produced: the `.text` bytes, or the assembler's error output. */
export type CorpusAssembly =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly stderr: string };
