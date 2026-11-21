// The PoC's results frozen as bench/baseline/poc-2026-10-16.json (D11) and the field-by-field
// comparison poc-check makes against it.
import { join } from 'node:path';
import { type JsonValue, canonicalJson, compareCodeUnits } from 'romlift';

import { type BenchContext, baselineDir } from './context.ts';
import { BenchError, isRecord, readJson } from './files.ts';

export const BASELINE_FILE = 'poc-2026-10-16.json';

export type JsonRecord = Readonly<Record<string, unknown>>;

export interface Baseline {
  readonly meta: JsonRecord;
  readonly roms: readonly JsonRecord[];
}

/** A value without its volatile `seconds`, at every depth (the row, its scaffold, its signatures). */
export function stripSeconds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSeconds);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) if (key !== 'seconds') out[key] = stripSeconds(field);
  return out;
}

export function parseBaseline(value: unknown, where: string): Baseline {
  if (!isRecord(value) || !isRecord(value['meta']) || !Array.isArray(value['roms'])) {
    throw new BenchError(`${where}: expected {"meta": {...}, "roms": [...]}`);
  }
  const roms: JsonRecord[] = [];
  for (const row of value['roms']) {
    if (!isRecord(row) || typeof row['name'] !== 'string') throw new BenchError(`${where}: a row has no name`);
    roms.push(row);
  }
  return { meta: value['meta'], roms };
}

export async function readBaseline(cx: BenchContext): Promise<Baseline> {
  const path = join(baselineDir(cx), BASELINE_FILE);
  return parseBaseline(await readJson(path), path);
}

/** The names of the ROMs the PoC baseline holds a row of: the tuning ROMs the pinned PoC's results cover. */
/** The pinned baseline's row of `name`, or undefined when the baseline names no such ROM. */
export function baselineRowOf(baseline: Baseline, name: string): JsonRecord | undefined {
  return baseline.roms.find((r) => r['name'] === name);
}

export function pocRomNames(baseline: Baseline): readonly string[] {
  return baseline.roms.map((r) => String(r['name']));
}

/** `value` without the dotted paths in `excluded` (`seconds`, `scaffold.summary`). */
export function withoutPaths(value: JsonRecord, excluded: readonly string[]): JsonRecord {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (excluded.includes(key)) continue;
    const nested = excluded.filter((p) => p.startsWith(`${key}.`)).map((p) => p.slice(key.length + 1));
    out[key] = nested.length > 0 && isRecord(field) ? withoutPaths(field, nested) : field;
  }
  return out;
}

const text = (value: unknown): string =>
  value === undefined ? 'absent' : Array.from(canonicalJson(value as JsonValue)).join('');

/** Field-by-field differences of two JSON values, as `path: expected X, got Y`; at most `limit`. */
export function jsonDiffs(expected: unknown, actual: unknown, path = '', limit = 20): string[] {
  const out: string[] = [];
  const walk = (want: unknown, have: unknown, at: string): void => {
    if (out.length >= limit) return;
    if (Array.isArray(want) && Array.isArray(have)) {
      const n = Math.max(want.length, have.length);
      if (want.length !== have.length) out.push(`${at}: expected ${want.length} items, got ${have.length}`);
      for (let i = 0; i < n; i++) walk(want[i], have[i], `${at}[${i}]`);
      return;
    }
    if (isRecord(want) && isRecord(have)) {
      const keys = Array.from(new Set([...Object.keys(want), ...Object.keys(have)])).sort(compareCodeUnits);
      for (const key of keys) walk(want[key], have[key], at === '' ? key : `${at}.${key}`);
      return;
    }
    const a = text(want);
    const b = text(have);
    if (a !== b) out.push(`${at}: expected ${a}, got ${b}`);
  };
  walk(expected, actual, path);
  return out;
}
