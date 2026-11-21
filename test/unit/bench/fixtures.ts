// Builders for the bench tests: in-memory ELF files, datasets, PoC dumps, hand-built analysis results and
// a runner that serves them, rows and artifacts, and temporary directories. Nothing here is derived from
// a ROM.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalysisResult, ElfFile, ElfSymbol, FunctionFact, MissReason, Mode, Origin, TrailEvent } from 'romlift';
import type { MissDiagnosis } from 'romlift/internal';

import type { AnalysisRunner } from '../../../bench/src/analysis-run.ts';
import type { Results, ResultsMeta } from '../../../bench/src/artifact.ts';
import type { Dataset } from '../../../bench/src/dataset.ts';
import type { BenchRow } from '../../../bench/src/row.ts';
import { type DumpFunction, SCORED_SCHEMA, type ScoredRun, analysisDigest } from '../../../bench/src/scored-run.ts';
import {
  type CorpusSummary,
  armCoverage,
  corpusSummary,
  summarizeCorpus,
} from '../../../src/foundation/corpus/corpus.ts';

export interface SymbolSpec {
  readonly name: string;
  readonly value: number;
  readonly size: number;
  readonly type?: ElfSymbol['type'];
}

/** An ELF value holding only the given symbols (func by default; odd values are Thumb). */
export function elfFile(symbols: readonly SymbolSpec[]): ElfFile {
  return {
    machine: 40,
    entry: 0x0800_0000,
    sections: [],
    symbols: symbols.map((s) => {
      const type = s.type ?? 'func';
      const func = type === 'func';
      return {
        name: s.name,
        value: s.value,
        addr: func ? (s.value & ~1) >>> 0 : s.value,
        size: s.size,
        type,
        bind: 'global',
        thumb: func && (s.value & 1) === 1,
        sectionIndex: 1,
      };
    }),
  };
}

export function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    name: 'tiny',
    rom: 'tiny/tiny.gba',
    elf: 'tiny/tiny.elf',
    map: 'tiny/tiny.map',
    sha1: '0'.repeat(40),
    elfCommit: 'abc1234',
    elfSha256: '0'.repeat(64),
    family: 'synthetic',
    buildNote: 'unchanged',
    heldout: false,
    revealed: [],
    labels: [],
    untyped: [],
    ...overrides,
  };
}

export const fn = (entry: string, end: string, origin = 'call', mode: 'thumb' | 'arm' = 'thumb'): DumpFunction => ({
  entry,
  end,
  origin,
  mode,
});

/** A well-formed (empty) corpus summary for the printer member of an artifact. */
export function printerSummary(): CorpusSummary {
  return corpusSummary(
    { inputsDigest: 'i'.repeat(64), as: 'GNU assembler (test) 2.45', options: { seed: 1, armSample: 0, blSample: 0 } },
    summarizeCorpus([], armCoverage()),
    false,
  );
}

/** A dump whose two digests are its analysis's own, unless overridden. */
export function dump(overrides: Partial<ScoredRun> = {}): ScoredRun {
  const analysis = overrides.analysis ?? {
    functions: [],
    startup: { end: '0x08000000', entries: [] },
    codeRange: ['0x08000000', '0x08000000'],
  };
  const digest = analysisDigest(analysis);
  return {
    schema: SCORED_SCHEMA,
    rom: 'tiny',
    sha1: '0'.repeat(40),
    pocSourceDigest: 'p'.repeat(64),
    datasetDigest: null,
    analysis,
    misses: [],
    digests: [digest, digest],
    scaffold: { ok: true, summary: 'built' },
    pocRow: {},
    ...overrides,
  };
}

export function row(overrides: Partial<BenchRow> = {}): BenchRow {
  return {
    name: 'tiny',
    sha1: '0'.repeat(40),
    elfCommit: 'abc1234',
    elfFunctions: 10,
    entries: 10,
    startup: { end: '0x08000100', pieces: 2, elfFunctions: 1 },
    thumb: 9,
    arm: 1,
    tp: 10,
    precision: 1,
    recall: 1,
    misses: [],
    falseEntries: [],
    extents: { sized: 10, agree: 10, mismatches: [] },
    codeEnd: { found: '0x08001000', elf: '0x08001000', delta: 0 },
    deterministic: true,
    scaffold: { ok: true },
    ...overrides,
  };
}

export function meta(overrides: Partial<ResultsMeta> = {}): ResultsMeta {
  return {
    commit: null,
    dirty: false,
    sourceDigest: 's'.repeat(64),
    nodeMajor: 24,
    romliftVersion: '0.0.0',
    inputs: { tiny: { sha1: '0'.repeat(40), elfSha256: '0'.repeat(64) }, pocSourceDigest: 'p'.repeat(64) },
    toolchain: { as: 'as 1', ld: 'ld 1', objcopy: 'objcopy 1' },
    families: { tiny: ['code-end', 'entries', 'extents', 'scaffold'] },
    source: 'poc',
    ...overrides,
  };
}

export function results(rows: readonly BenchRow[] = [row()], overrides: Partial<Results> = {}): Results {
  return { meta: meta(), gates: { real: [] }, roms: rows, ...overrides };
}

/** Runs `body` with a fresh temporary directory, removed afterwards. */
export async function withTempDir<T>(prefix: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A function fact with only its entry, extent, mode and origin set; every other list empty. */
export function fact(
  entry: number,
  end: number,
  origin: Origin = 'call',
  mode: Mode = 'thumb',
  overrides: Partial<FunctionFact> = {},
): FunctionFact {
  return {
    entry,
    mode,
    extent: { start: entry, end },
    codeEnd: end,
    code: [{ start: entry, end }],
    dead: [],
    pools: [],
    farPools: [],
    tables: [],
    calls: [],
    blVerdicts: [],
    exits: [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: [],
    origin,
    accepted: { rule: 'seed.call', round: 0, cites: [] },
    also: [],
    ...overrides,
  };
}

/** A discover result holding `functions`, the startup region [0x08000000, startupEnd) and `codeEnd`. */
export function analysisResult(
  functions: readonly FunctionFact[],
  startup: { readonly end: number; readonly entries: readonly number[] },
  codeEnd: number,
): AnalysisResult {
  return {
    schema: 'romlift/analysis@1',
    mode: 'discover',
    rom: { sha1: '0'.repeat(40), end: 0x0800_1000 },
    profile: 'agbcc',
    options: { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    functions: [...functions].sort((a, b) => a.entry - b.entry),
    claims: [],
    startup: { span: { start: 0x0800_0000, end: startup.end }, entries: startup.entries },
    codeEnd,
    rejections: [],
    diagnostics: [],
  };
}

export interface FixedRunnerOptions {
  /** The reason diagnoseMisses gives each address; 'inside-code' for the others. */
  readonly reasons?: ReadonlyMap<number, MissReason>;
  /** The result of the second run (diagnoseMisses), to fake a non-deterministic analysis. */
  readonly second?: AnalysisResult;
  /** Called with every analyze call, to see what the bench asked for. */
  readonly onAnalyze?: (call: {
    readonly trail: string;
    readonly disabled: readonly string[];
    readonly filter?: { readonly start: number; readonly end: number };
  }) => void;
  /** Trail events streamed to the sink of every analyze call that passes one. */
  readonly events?: readonly TrailEvent[];
  /** The result when a rule is disabled. */
  readonly ablated?: (disabled: readonly string[]) => AnalysisResult | undefined;
}

/** A runner that serves `result` whatever the ROM, and diagnoses misses from `reasons`. */
export function fixedRunner(result: AnalysisResult, options: FixedRunnerOptions = {}): AnalysisRunner {
  return {
    analyze(_rom, _profile, opts, tuning, sink) {
      options.onAnalyze?.({
        trail: opts.trail,
        disabled: tuning.disabled,
        ...(opts.trailFilter === undefined ? {} : { filter: opts.trailFilter }),
      });
      if (sink !== undefined) for (const e of options.events ?? []) sink.event(e);
      return (tuning.disabled.length > 0 ? options.ablated?.(tuning.disabled) : undefined) ?? result;
    },
    diagnose(_rom, _profile, _opts, _tuning, misses) {
      const diagnoses: MissDiagnosis[] = misses.map((m) => ({
        addr: m.addr,
        mode: m.mode,
        reason: options.reasons?.get(m.addr) ?? 'inside-code',
        detail: 'test',
      }));
      return { result: options.second ?? result, diagnoses };
    },
  };
}

/** A runner whose analysis throws, as analyze does while a pipeline rule has no implementation. */
export function failingRunner(
  message = 'profile agbcc: pipeline rule seed.rom-entry has no implementation',
): AnalysisRunner {
  const fail = (): never => {
    throw new Error(message);
  };
  return { analyze: fail, diagnose: fail };
}
