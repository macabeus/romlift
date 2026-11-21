// The rows of a romlift run against the PoC baseline, bench/baseline/poc-2026-10-16.json (architecture
// §4.5 "What a row change may be", g2.baseline-rows, g2.extents, g2.poc-parity). Three lists are
// compared row by row: the misses (on their reason), the false entries (on their origin, size and owning
// ELF function) and the extent mismatches (on the ELF size and the found extent). The listing fields
// `listed` and `category` describe the dataset, not the analysis, and are not compared. Kinds:
//
//   miss-removed, false-entry-removed, extent-agrees     improvements (accepted-diffs.json may list them)
//   miss-added, miss-changed, false-entry-added, false-entry-changed, extent-mismatch-added,
//   extent-changed, extent-unscored (a baseline mismatch whose function is no longer found)   changes
//
// `lost` holds the extents that agreed in the baseline and do not now: a mismatch now at a function the
// baseline neither misses nor lists as a mismatch. Pure: rows in, diffs out.
import { compareCodeUnits } from 'romlift';

import { type AcceptedImprovement, isImprovement } from './accepted-diffs.ts';
import type { JsonRecord } from './baseline.ts';
import { BenchError, isRecord } from './files.ts';
import type { BaselineRows, BenchRow, ExtentRow, RowDiff } from './row.ts';

interface BaseMiss {
  readonly addr: string;
  readonly reason: string;
}

interface BaseFalse {
  readonly addr: string;
  readonly origin: string;
  readonly size: number;
  readonly owner?: string;
}

/** The fields of a baseline row that the comparison reads. */
export interface BaselineRow {
  readonly name: string;
  readonly tp: number;
  readonly misses: readonly BaseMiss[];
  readonly falseEntries: readonly BaseFalse[];
  readonly mismatches: readonly ExtentRow[];
}

function list(row: JsonRecord, key: string, where: string): readonly JsonRecord[] {
  const value = row[key];
  if (!Array.isArray(value) || !value.every(isRecord))
    throw new BenchError(`${where}.${key} must be a list of objects`);
  return value;
}

function str(r: JsonRecord, key: string, where: string): string {
  const value = r[key];
  if (typeof value !== 'string') throw new BenchError(`${where}.${key} must be a string`);
  return value;
}

function num(r: JsonRecord, key: string, where: string): number {
  const value = r[key];
  if (typeof value !== 'number') throw new BenchError(`${where}.${key} must be a number`);
  return value;
}

/** Reads one row of the baseline file. */
export function parseBaselineRow(row: JsonRecord, where: string): BaselineRow {
  const at = `${where}: row ${String(row['name'])}`;
  const extents = row['extents'];
  if (!isRecord(extents)) throw new BenchError(`${at}.extents must be an object`);
  return {
    name: str(row, 'name', at),
    tp: num(row, 'tp', at),
    misses: list(row, 'misses', at).map((m) => ({ addr: str(m, 'addr', at), reason: str(m, 'reason', at) })),
    falseEntries: list(row, 'falseEntries', at).map((f) => ({
      addr: str(f, 'addr', at),
      origin: str(f, 'origin', at),
      size: num(f, 'size', at),
      ...(typeof f['owner'] === 'string' ? { owner: f['owner'] } : {}),
    })),
    mismatches: list(extents, 'mismatches', `${at}.extents`).map((m) => ({
      addr: str(m, 'addr', at),
      name: str(m, 'name', at),
      elf: num(m, 'elf', at),
      found: num(m, 'found', at),
    })),
  };
}

const byAddrThenKind = (a: RowDiff, b: RowDiff): number =>
  compareCodeUnits(a.addr, b.addr) || compareCodeUnits(a.kind, b.kind);

/**
 * Every row of `row` that differs from `base`. `found` holds the hex entries the run found (startup
 * included), to tell an extent that now agrees from one whose function is no longer found.
 */
export function rowDiffs(
  base: BaselineRow,
  row: Pick<BenchRow, 'misses' | 'falseEntries' | 'extents'>,
  found: ReadonlySet<string>,
): RowDiff[] {
  const diffs: RowDiff[] = [];
  const misses = new Map(row.misses.map((m) => [m.addr, m]));
  const baseMisses = new Map(base.misses.map((m) => [m.addr, m]));
  for (const m of base.misses) {
    const now = misses.get(m.addr);
    if (now === undefined) diffs.push({ kind: 'miss-removed', addr: m.addr });
    else if (now.reason !== m.reason) diffs.push({ kind: 'miss-changed', addr: m.addr });
  }
  for (const m of row.misses) if (!baseMisses.has(m.addr)) diffs.push({ kind: 'miss-added', addr: m.addr });

  const falses = new Map(row.falseEntries.map((f) => [f.addr, f]));
  const baseFalses = new Map(base.falseEntries.map((f) => [f.addr, f]));
  for (const f of base.falseEntries) {
    const now = falses.get(f.addr);
    if (now === undefined) diffs.push({ kind: 'false-entry-removed', addr: f.addr });
    else if (now.origin !== f.origin || now.size !== f.size || now.owner !== f.owner)
      diffs.push({ kind: 'false-entry-changed', addr: f.addr });
  }
  for (const f of row.falseEntries)
    if (!baseFalses.has(f.addr)) diffs.push({ kind: 'false-entry-added', addr: f.addr });

  const mismatches = new Map(row.extents.mismatches.map((m) => [m.addr, m]));
  const baseMismatches = new Map(base.mismatches.map((m) => [m.addr, m]));
  for (const m of base.mismatches) {
    const now = mismatches.get(m.addr);
    if (now === undefined) diffs.push({ kind: found.has(m.addr) ? 'extent-agrees' : 'extent-unscored', addr: m.addr });
    else if (now.elf !== m.elf || now.found !== m.found) diffs.push({ kind: 'extent-changed', addr: m.addr });
  }
  for (const m of row.extents.mismatches)
    if (!baseMismatches.has(m.addr)) diffs.push({ kind: 'extent-mismatch-added', addr: m.addr });
  return diffs.sort(byAddrThenKind);
}

/** The extents that agreed in the baseline and do not now. */
export function lostExtents(base: BaselineRow, row: Pick<BenchRow, 'extents'>): ExtentRow[] {
  const known = new Set([...base.mismatches.map((m) => m.addr), ...base.misses.map((m) => m.addr)]);
  return row.extents.mismatches.filter((m) => !known.has(m.addr));
}

/** The diffs against the accepted improvements of one ROM: what is not accepted, and what is accepted but no longer differs. */
export function judgeDiffs(
  diffs: readonly RowDiff[],
  accepted: readonly Pick<AcceptedImprovement, 'kind' | 'addr'>[],
): BaselineRows {
  const key = (d: Pick<RowDiff, 'kind' | 'addr'>): string => `${d.kind} ${d.addr}`;
  const listed = new Set(accepted.map(key));
  const present = new Set(diffs.map(key));
  return {
    diffs: [...diffs],
    unaccepted: diffs.filter((d) => !isImprovement(d.kind) || !listed.has(key(d))),
    staleAccepted: accepted
      .filter((a) => !present.has(key(a)))
      .map((a) => ({ kind: a.kind, addr: a.addr }))
      .sort(byAddrThenKind),
  };
}

export interface BaselineComparison {
  readonly poc: { readonly tp: number };
  readonly lost: readonly ExtentRow[];
  readonly baselineRows: BaselineRows;
}

/** Everything a romlift row carries about the PoC baseline. */
export function compareWithBaseline(
  base: BaselineRow,
  row: Pick<BenchRow, 'misses' | 'falseEntries' | 'extents'>,
  found: ReadonlySet<string>,
  accepted: readonly Pick<AcceptedImprovement, 'kind' | 'addr'>[],
): BaselineComparison {
  return {
    poc: { tp: base.tp },
    lost: lostExtents(base, row),
    baselineRows: judgeDiffs(rowDiffs(base, row, found), accepted),
  };
}
