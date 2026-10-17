// bench/baseline/accepted-diffs.json (architecture §4.5 "What a row change may be", D10): the rows that
// may differ from the PoC baseline. Only improvements may be listed: a miss removed, a false entry
// removed, an extent that now agrees, each with the commit that made it and a reason. A regression is
// fixed in the rules, never accepted, so the reader refuses any other kind.
import { join } from 'node:path';

import { compareCodeUnits } from 'romlift';

import { baselineDir, type BenchContext } from './context.ts';
import { BenchError, exists, isRecord, readJson } from './files.ts';

export const ACCEPTED_DIFFS_SCHEMA = 'romlift-bench/accepted-diffs@1';
export const ACCEPTED_DIFFS_FILE = 'accepted-diffs.json';

/** The diff kinds that are improvements against the PoC baseline; nothing else may be accepted. */
export const IMPROVEMENT_KINDS = ['miss-removed', 'false-entry-removed', 'extent-agrees'] as const;
export type ImprovementKind = (typeof IMPROVEMENT_KINDS)[number];

export function isImprovement(kind: string): kind is ImprovementKind {
  return (IMPROVEMENT_KINDS as readonly string[]).includes(kind);
}

export interface AcceptedImprovement {
  readonly rom: string;
  readonly kind: ImprovementKind;
  readonly addr: string;
  readonly commit: string;
  readonly reason: string;
}

export interface AcceptedDiffs {
  readonly schema: typeof ACCEPTED_DIFFS_SCHEMA;
  readonly improvements: readonly AcceptedImprovement[];
}

const ADDR = /^0x[0-9A-F]{8}$/;

/** Reads the file's value; throws a BenchError naming the first entry that is malformed, not an improvement, or listed twice. */
export function parseAcceptedDiffs(value: unknown, where: string): AcceptedDiffs {
  if (!isRecord(value) || value['schema'] !== ACCEPTED_DIFFS_SCHEMA || !Array.isArray(value['improvements'])) {
    throw new BenchError(`${where}: expected {"schema": "${ACCEPTED_DIFFS_SCHEMA}", "improvements": [...]}`);
  }
  const seen = new Set<string>();
  const improvements = value['improvements'].map((item: unknown, i: number): AcceptedImprovement => {
    const at = `${where}: improvements[${i}]`;
    if (!isRecord(item)) throw new BenchError(`${at} is not an object`);
    const text = (key: string): string => {
      const field = item[key];
      if (typeof field !== 'string' || field.trim() === '') throw new BenchError(`${at}.${key} must be a non-empty string`);
      return field;
    };
    const kind = text('kind');
    if (!isImprovement(kind)) throw new BenchError(`${at}: '${kind}' is not an improvement (${IMPROVEMENT_KINDS.join(', ')}); a regression is fixed in the rules, never accepted`);
    const addr = text('addr');
    if (!ADDR.test(addr)) throw new BenchError(`${at}.addr: ${addr} is not 0x plus eight upper-case hex digits`);
    const entry = { rom: text('rom'), kind, addr, commit: text('commit'), reason: text('reason') };
    const key = `${entry.rom} ${entry.kind} ${entry.addr}`;
    if (seen.has(key)) throw new BenchError(`${at}: ${key} is listed twice`);
    seen.add(key);
    return entry;
  });
  return { schema: ACCEPTED_DIFFS_SCHEMA, improvements };
}

export const acceptedDiffsPath = (cx: BenchContext): string => join(baselineDir(cx), ACCEPTED_DIFFS_FILE);

/** The committed file; an absent file accepts nothing. */
export async function readAcceptedDiffs(cx: BenchContext): Promise<AcceptedDiffs> {
  const path = acceptedDiffsPath(cx);
  if (!(await exists(path))) return { schema: ACCEPTED_DIFFS_SCHEMA, improvements: [] };
  return parseAcceptedDiffs(await readJson(path), path);
}

/** The accepted improvements of one ROM, by kind then address. */
export function acceptedFor(diffs: AcceptedDiffs, rom: string): AcceptedImprovement[] {
  return diffs.improvements.filter((d) => d.rom === rom).sort((a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.addr, b.addr));
}
