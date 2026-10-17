// Scores one run against the ELF truth (architecture §8.1, the PoC's score.ts and runRom): entries and
// ELF functions counted from the end of the startup region, true positives, false entries with their
// origin and owning ELF function (the first containing one in symbol-table order), misses with their
// reason, extents with the 4-byte padding allowance, and the code end. Two runs are scored the same way:
// romlift's own AnalysisResult with its miss diagnoses (scoreAnalysis, `bench run`), and a PoC dump
// (scoreRun, `bench poc-check`). Pure: the run, the truth and the dataset in, one row out.
import { compareCodeUnits, compareNumbers, hexAddr, type AnalysisResult, type MissReason, type Mode, type Origin } from 'romlift';
import type { MissDiagnosis } from 'romlift/internal';

import { rowAddr, type Dataset } from './dataset.ts';
import { BenchError } from './files.ts';
import type { BenchRow, ExtentRow, FalseRow, MissRow, StaleException } from './row.ts';
import { dumpAddr, missReasonId, originId, type ScoredRun } from './scored-run.ts';
import { elfCodeEnd, type Truth } from './truth.ts';

/** An extent agrees when the ELF size equals it, or equals it padded to a multiple of 4. */
export function extentAgrees(elfSize: number, extent: number): boolean {
  return elfSize === extent || elfSize === extent + ((4 - (extent & 3)) & 3);
}

/** A function a run found: its entry, the end of its extent, its mode and its origin. */
export interface FoundFunction {
  readonly entry: number;
  readonly end: number;
  readonly mode: Mode;
  readonly origin: Origin;
}

/** What scoring reads of one run, whichever implementation produced it. */
export interface RunParts {
  readonly functions: readonly FoundFunction[];
  readonly startup: { readonly end: number; readonly pieces: number };
  readonly codeEnd: number;
  /** The reason of a missed ELF function, undefined when the run has no diagnosis for it. */
  readonly missReason: (addr: number) => MissReason | undefined;
  readonly deterministic: boolean;
  readonly scaffold?: { readonly ok: boolean };
}

export interface ScoreContext {
  readonly truth: Truth;
  readonly dataset: Dataset;
  /** The ROM SHA-1 the run verified. */
  readonly sha1: string;
}

const byAddrText = (x: { readonly addr: string }, y: { readonly addr: string }): number => compareCodeUnits(x.addr, y.addr);

/** The row of one run. */
export function scoreParts(run: RunParts, { truth, dataset, sha1 }: ScoreContext): BenchRow {
  const startupEnd = run.startup.end;
  const all = [...run.functions].sort((a, b) => compareNumbers(a.entry, b.entry));
  const byEntry = new Map(all.map((f) => [f.entry, f]));
  const found = all.filter((f) => f.entry >= startupEnd);
  const truthFrom = truth.functions.filter((t) => t.addr >= startupEnd);
  const truthFromAddr = new Set(truthFrom.map((t) => t.addr));
  const foundEntries = new Set(found.map((f) => f.entry));
  const labels = new Map(dataset.labels.map((e) => [e.addr, e]));
  const untyped = new Map(dataset.untyped.map((e) => [e.addr, e]));

  let tp = 0;
  const falseEntries: FalseRow[] = [];
  for (const f of found) {
    if (truthFromAddr.has(f.entry)) {
      tp++;
      continue;
    }
    const owner = truthFrom.find((t) => f.entry > t.addr && f.entry < t.addr + t.size);
    const addr = hexAddr(f.entry);
    const listed = untyped.get(addr);
    falseEntries.push({
      addr,
      origin: f.origin,
      size: f.end - f.entry,
      ...(owner === undefined ? {} : { owner: owner.name }),
      listed: listed !== undefined,
      ...(listed === undefined ? {} : { category: listed.category }),
    });
  }

  const misses: MissRow[] = [];
  for (const t of truthFrom) {
    if (foundEntries.has(t.addr)) continue;
    const reason = run.missReason(t.addr);
    if (reason === undefined) throw new BenchError(`${dataset.name}: no miss diagnosis for ${hexAddr(t.addr)} ${t.name}`);
    const addr = hexAddr(t.addr);
    const listed = labels.get(addr);
    misses.push({ addr, name: t.name, size: t.size, reason, listed: listed !== undefined, ...(listed === undefined ? {} : { category: listed.category }) });
  }

  let sized = 0;
  let agree = 0;
  for (const f of found) {
    const t = truth.byAddr.get(f.entry);
    if (t === undefined || !truthFromAddr.has(f.entry) || t.size === 0) continue;
    sized++;
    if (extentAgrees(t.size, f.end - f.entry)) agree++;
  }
  // The PoC lists extent mismatches over every ELF function, startup included.
  const mismatches: ExtentRow[] = [];
  for (const t of truth.functions) {
    const f = byEntry.get(t.addr);
    if (f === undefined || t.size === 0) continue;
    const extent = f.end - t.addr;
    if (!extentAgrees(t.size, extent)) mismatches.push({ addr: hexAddr(t.addr), name: t.name, elf: t.size, found: extent });
  }

  // A dataset's codeEnd row gives the end of an unsized last function (D60 j); dataset-check proves it.
  const elfEnd = dataset.codeEnd === undefined ? elfCodeEnd(truth) : rowAddr(dataset.codeEnd.addr);
  return {
    name: dataset.name,
    sha1,
    elfCommit: dataset.elfCommit,
    elfFunctions: truthFrom.length,
    entries: found.length,
    startup: { end: hexAddr(startupEnd), pieces: run.startup.pieces, elfFunctions: truth.functions.length - truthFrom.length },
    thumb: found.filter((f) => f.mode === 'thumb').length,
    arm: found.filter((f) => f.mode === 'arm').length,
    tp,
    // 0 rather than NaN for an empty run (JSON has no NaN); the PoC never scored one.
    precision: found.length === 0 ? 0 : tp / found.length,
    recall: truthFrom.length === 0 ? 0 : tp / truthFrom.length,
    misses: misses.sort(byAddrText),
    falseEntries: falseEntries.sort(byAddrText),
    extents: { sized, agree, mismatches: mismatches.sort(byAddrText) },
    codeEnd: { found: hexAddr(run.codeEnd), elf: hexAddr(elfEnd), delta: run.codeEnd - elfEnd },
    deterministic: run.deterministic,
    ...(run.scaffold === undefined ? {} : { scaffold: { ok: run.scaffold.ok } }),
  };
}

// ---------------------------------------------------------------- romlift's analysis

/** The functions an analysis found, as scoring reads them (the extent end is the PoC's Func.end). */
export function analysisFunctions(result: Pick<AnalysisResult, 'functions'>): FoundFunction[] {
  return result.functions.map((f) => ({ entry: f.entry, end: f.extent.end, mode: f.mode, origin: f.origin }));
}

export interface AnalysisScoreInput extends ScoreContext {
  readonly result: AnalysisResult;
  /** One diagnosis per ELF function the run missed (diagnoseMisses). */
  readonly diagnoses: readonly MissDiagnosis[];
  /** Whether a second run gave the same analysis digest. */
  readonly deterministic: boolean;
  /** The PoC dump's scaffold verdict, while phase 3 has not replaced it. */
  readonly scaffold?: { readonly ok: boolean };
}

/** The row of romlift's own discover run (D24). */
export function scoreAnalysis(input: AnalysisScoreInput): BenchRow {
  const reasons = new Map(input.diagnoses.map((d) => [d.addr, d.reason]));
  const { result } = input;
  return scoreParts(
    {
      functions: analysisFunctions(result),
      startup: { end: result.startup.span.end, pieces: result.startup.entries.length },
      codeEnd: result.codeEnd,
      missReason: (addr) => reasons.get(addr),
      deterministic: input.deterministic,
      ...(input.scaffold === undefined ? {} : { scaffold: input.scaffold }),
    },
    input,
  );
}

// ---------------------------------------------------------------- the PoC's dumps

/** The functions of a PoC dump, as scoring reads them; an origin text that names no origin is refused. */
export function dumpFunctions(dump: ScoredRun, name: string): FoundFunction[] {
  return dump.analysis.functions.map((f) => {
    const entry = dumpAddr(f.entry);
    const origin = originId(f.origin);
    if (origin === undefined) throw new BenchError(`${name}: unknown PoC origin '${f.origin}' at ${hexAddr(entry)}`);
    return { entry, end: dumpAddr(f.end), mode: f.mode, origin };
  });
}

export interface ScoreInput extends ScoreContext {
  readonly dump: ScoredRun;
}

/** The row of a PoC dump (poc-check, g1.bench-harness). */
export function scoreRun({ dump, truth, dataset, sha1 }: ScoreInput): BenchRow {
  const reasons = new Map(dump.misses.map((m) => [dumpAddr(m.addr), missReasonId(m.reason)]));
  return scoreParts(
    {
      functions: dumpFunctions(dump, dataset.name),
      startup: { end: dumpAddr(dump.analysis.startup.end), pieces: dump.analysis.startup.entries.length },
      codeEnd: dumpAddr(dump.analysis.codeRange[1]),
      missReason: (addr) => reasons.get(addr),
      deterministic: dump.digests[0] === dump.digests[1],
      scaffold: { ok: dump.scaffold.ok },
    },
    { truth, dataset, sha1 },
  );
}

// ---------------------------------------------------------------- dataset rows

/** Whether `addr` lies strictly inside a found function's extent and is not itself an entry. */
export function insideFoundFunction(found: readonly Pick<FoundFunction, 'entry' | 'end'>[], addr: number): boolean {
  let inside = false;
  for (const f of found) {
    if (f.entry === addr) return false;
    if (addr > f.entry && addr < f.end) inside = true;
  }
  return inside;
}

/** The dataset rows the row no longer needs: labels it does not miss, untyped rows it does not report. */
export function staleExceptions(dataset: Pick<Dataset, 'labels' | 'untyped'>, row: Pick<BenchRow, 'misses' | 'falseEntries'>): StaleException[] {
  const missed = new Set(row.misses.map((m) => m.addr));
  const reported = new Set(row.falseEntries.map((f) => f.addr));
  return [
    ...dataset.labels.filter((e) => !missed.has(e.addr)).map((e) => ({ list: 'labels' as const, addr: e.addr })),
    ...dataset.untyped.filter((e) => !reported.has(e.addr)).map((e) => ({ list: 'untyped' as const, addr: e.addr })),
  ];
}
