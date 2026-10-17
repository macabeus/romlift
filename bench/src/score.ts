// Scores one PoC dump against the ELF truth (architecture §8.1, the PoC's score.ts and runRom): entries
// and ELF functions counted from the end of the startup region, true positives, false entries with
// their origin and owning ELF function, misses with their reason, extents with the 4-byte padding
// allowance, and the code end. Pure: the dump, the truth and the dataset in, one row out.
import { compareCodeUnits, compareNumbers, hexAddr } from 'romlift';

import type { Dataset } from './dataset.ts';
import { BenchError } from './files.ts';
import type { BenchRow, ExtentRow, FalseRow, MissRow } from './row.ts';
import { dumpAddr, missReasonId, originId, type ScoredRun } from './scored-run.ts';
import type { Truth } from './truth.ts';

/** An extent agrees when the ELF size equals it, or equals it padded to a multiple of 4. */
export function extentAgrees(elfSize: number, extent: number): boolean {
  return elfSize === extent || elfSize === extent + ((4 - (extent & 3)) & 3);
}

interface Found {
  readonly entry: number;
  readonly end: number;
  readonly mode: 'thumb' | 'arm';
  readonly origin: string;
}

function foundFunctions(dump: ScoredRun): Found[] {
  return dump.analysis.functions
    .map((f) => ({ entry: dumpAddr(f.entry), end: dumpAddr(f.end), mode: f.mode, origin: f.origin }))
    .sort((a, b) => compareNumbers(a.entry, b.entry));
}

export interface ScoreInput {
  readonly dump: ScoredRun;
  readonly truth: Truth;
  readonly dataset: Dataset;
  /** The ROM SHA-1 the run verified. */
  readonly sha1: string;
}

export function scoreRun({ dump, truth, dataset, sha1 }: ScoreInput): BenchRow {
  const startupEnd = dumpAddr(dump.analysis.startup.end);
  const all = foundFunctions(dump);
  const byEntry = new Map(all.map((f) => [f.entry, f]));
  const found = all.filter((f) => f.entry >= startupEnd);
  const truthFrom = truth.functions.filter((t) => t.addr >= startupEnd);
  const truthFromAddr = new Set(truthFrom.map((t) => t.addr));
  const foundEntries = new Set(found.map((f) => f.entry));
  const reasons = new Map(dump.misses.map((m) => [dumpAddr(m.addr), m.reason]));
  const labels = new Map(dataset.labels.map((e) => [e.addr, e]));
  const untyped = new Map(dataset.untyped.map((e) => [e.addr, e]));

  let tp = 0;
  const falseEntries: FalseRow[] = [];
  for (const f of found) {
    if (truthFromAddr.has(f.entry)) {
      tp++;
      continue;
    }
    const origin = originId(f.origin);
    if (origin === undefined) throw new BenchError(`${dataset.name}: unknown PoC origin '${f.origin}' at ${hexAddr(f.entry)}`);
    const owner = truthFrom.find((t) => f.entry > t.addr && f.entry < t.addr + t.size);
    const addr = hexAddr(f.entry);
    const listed = untyped.get(addr);
    falseEntries.push({
      addr,
      origin,
      size: f.end - f.entry,
      ...(owner === undefined ? {} : { owner: owner.name }),
      listed: listed !== undefined,
      ...(listed === undefined ? {} : { category: listed.category }),
    });
  }

  const misses: MissRow[] = [];
  for (const t of truthFrom) {
    if (foundEntries.has(t.addr)) continue;
    const text = reasons.get(t.addr);
    if (text === undefined) throw new BenchError(`${dataset.name}: the dump has no miss diagnosis for ${hexAddr(t.addr)} ${t.name}`);
    const addr = hexAddr(t.addr);
    const listed = labels.get(addr);
    misses.push({
      addr,
      name: t.name,
      size: t.size,
      reason: missReasonId(text),
      listed: listed !== undefined,
      ...(listed === undefined ? {} : { category: listed.category }),
    });
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

  const codeEnd = dumpAddr(dump.analysis.codeRange[1]);
  const elfEnd = truth.functions.reduce((e, t) => Math.max(e, t.addr + t.size), 0);
  const byAddrText = (x: { readonly addr: string }, y: { readonly addr: string }): number => compareCodeUnits(x.addr, y.addr);
  return {
    name: dataset.name,
    sha1,
    elfCommit: dataset.elfCommit,
    elfFunctions: truthFrom.length,
    entries: found.length,
    startup: { end: hexAddr(startupEnd), pieces: dump.analysis.startup.entries.length, elfFunctions: truth.functions.length - truthFrom.length },
    thumb: found.filter((f) => f.mode === 'thumb').length,
    arm: found.filter((f) => f.mode === 'arm').length,
    tp,
    precision: tp / found.length,
    recall: tp / truthFrom.length,
    misses: misses.sort(byAddrText),
    falseEntries: falseEntries.sort(byAddrText),
    extents: { sized, agree, mismatches: mismatches.sort(byAddrText) },
    codeEnd: { found: hexAddr(codeEnd), elf: hexAddr(elfEnd), delta: codeEnd - elfEnd },
    deterministic: dump.digests[0] === dump.digests[1],
    scaffold: { ok: dump.scaffold.ok },
  };
}

/** Whether `addr` lies strictly inside a found function's extent and is not itself an entry. */
export function insideFoundFunction(dump: ScoredRun, addr: number): boolean {
  let inside = false;
  for (const f of dump.analysis.functions) {
    const entry = dumpAddr(f.entry);
    if (entry === addr) return false;
    if (addr > entry && addr < dumpAddr(f.end)) inside = true;
  }
  return inside;
}
