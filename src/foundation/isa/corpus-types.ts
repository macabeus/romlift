// The data of the round-trip corpus: options, cases, files and the frozen summary contract
// (`romlift/corpus-summary@1`). corpus.ts is the entry point; this file holds what every corpus
// module shares.
import type { Mode } from '../rom/span.ts';
import type { Assembled, Insn, InsnSpec, ParsedInsn, RawReason, SpecId, SymbolResolver } from './types.ts';

/** The isa functions the corpus exercises; injected so a test can break one and watch the corpus fail. */
export interface CorpusIsa {
  readonly decode: (mode: Mode, word: number, addr: number) => Insn;
  readonly format: (insn: Insn, resolver: SymbolResolver) => string | undefined;
  readonly formatRaw: (insn: Insn) => string;
  readonly parse: (text: string, mode: Mode, addr: number, resolver: SymbolResolver) => ParsedInsn | undefined;
  readonly assemble: (parsed: ParsedInsn, addr: number) => Assembled | undefined;
  readonly rawReason: (insn: Insn, resolver: SymbolResolver) => RawReason | null;
  readonly specOf: (id: SpecId) => InsnSpec;
  readonly specs: (mode: Mode) => readonly InsnSpec[];
  readonly preamble: (mode: Mode) => string;
}

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
export type ArmCoverage = Readonly<Record<string, { readonly exhaustive: readonly string[]; readonly sampled: readonly string[] }>>;

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

/** The frozen summary contract `romlift/corpus-summary@1`, consumed by the gate files and the bench. */
export interface CorpusSummary {
  readonly schema: 'romlift/corpus-summary@1';
  readonly inputsDigest: string;
  readonly as: string;
  readonly options: CorpusOptions;
  readonly sections: {
    readonly thumb: CorpusSectionSummary;
    readonly bl: CorpusSectionSummary;
    readonly arm: CorpusSectionSummary & { readonly coverage: ArmCoverage };
  };
  readonly encoderAgrees: { readonly checked: number; readonly disagree: number; readonly examples: readonly CorpusExample[] };
  readonly context: {
    readonly checked: number;
    readonly disagree: number;
    readonly alignments: readonly Alignment[];
    readonly extremes: number;
    readonly examples: readonly CorpusExample[];
  };
  readonly ok: boolean;
}

/** What assembling one corpus file produced: the `.text` bytes, or the assembler's error output. */
export type CorpusAssembly = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly stderr: string };
