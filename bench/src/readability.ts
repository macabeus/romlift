// The readability family (architecture §8.4 "Readability", D34, D62 d): the readable printer's shares over
// the model of a seedless discover run (configFromDiscover, buildModel), from the PrintStats printChunk
// returns for every chunk, and their floors, bench/baseline/readability.json, the first committed shares of
// each tuning ROM (written once by the phase lead, `bench run --scaffold --write-readability-floor`, which
// only adds the ROMs that have none). Also the tree digest of a ROM's emission stream, as
// g3.tree-determinism computes it.
//
//   mnemonicShare        1 - rawInsns / insns   (insns counts every instruction item, the raw ones included)
//   symbolicBranchShare  symbolicBranches / branches
//   symbolicPoolShare    symbolicPoolLoads / poolLoads
// each 1 when its denominator is 0 (D62 d; the header of test/gates/g3.readability.test.ts).
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { addPrintStats, compareCodeUnits, emptyPrintStats, printChunk, type FileEntry, type Model, type PrintStats, type Rom } from 'romlift';

import { baselineDir, type BenchContext } from './context.ts';
import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';

export const SHARE_NAMES = ['mnemonicShare', 'symbolicBranchShare', 'symbolicPoolShare'] as const;
export type ShareName = (typeof SHARE_NAMES)[number];
export type Shares = Readonly<Record<ShareName, number>>;

/** A tuning row's `readability` member: the shares and the floor (null when the floor file has none for the ROM). */
export type ReadabilityMember = Shares & { readonly floor: Shares | null };

const share = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);

/** The three shares of one ROM's statistics. */
export function sharesOf(stats: PrintStats): Shares {
  return {
    mnemonicShare: stats.insns === 0 ? 1 : 1 - stats.rawInsns / stats.insns,
    symbolicBranchShare: share(stats.symbolicBranches, stats.branches),
    symbolicPoolShare: share(stats.symbolicPoolLoads, stats.poolLoads),
  };
}

/**
 * The readable printer's statistics over every chunk that holds code. Header and data chunks hold no
 * instruction item, so they add nothing; they are not printed (a data chunk can span megabytes).
 */
export function readableStats(rom: Rom, model: Model): PrintStats {
  let stats = emptyPrintStats();
  model.chunks.forEach((chunk, i) => {
    if (chunk.kind === 'header' || chunk.kind === 'data') return;
    stats = addPrintStats(stats, printChunk(rom, model, i, 'readable').stats);
  });
  return stats;
}

export function readabilityMember(shares: Shares, floor: Shares | undefined): ReadabilityMember {
  return { ...shares, floor: floor ?? null };
}

// ---------------------------------------------------------------------------------------------------
// The tree digest

/** What one pass over an emission stream keeps: its paths in stream order and the digest. */
export interface TreePass {
  readonly paths: readonly string[];
  readonly treeDigest: string;
}

/** The text an entry contributes: its text, or a reconciled entry's edits as JSON (g3.tree-determinism). */
function entryBody(entry: FileEntry): string {
  return entry.ownership === 'reconciled' ? JSON.stringify(entry.edits) : entry.text;
}

/** sha256 over path, NUL, body, NUL for each entry in stream order, and the paths. */
export function treePass(entries: Iterable<FileEntry>): TreePass {
  const hash = createHash('sha256');
  const paths: string[] = [];
  for (const entry of entries) {
    hash.update(`${entry.path}\0${entryBody(entry)}\0`);
    paths.push(entry.path);
  }
  return { paths, treeDigest: hash.digest('hex') };
}

// ---------------------------------------------------------------------------------------------------
// The floor file

export const READABILITY_FLOOR_SCHEMA = 'romlift-bench/readability-floor@1';

export interface ReadabilityFloors {
  readonly schema: typeof READABILITY_FLOOR_SCHEMA;
  readonly roms: Readonly<Record<string, Shares>>;
}

export const readabilityFloorPath = (cx: BenchContext): string => join(baselineDir(cx), 'readability.json');

function sharesFrom(value: unknown, at: string): Shares {
  if (!isRecord(value)) throw new BenchError(`${at} must be an object`);
  const out: Partial<Record<ShareName, number>> = {};
  for (const name of SHARE_NAMES) {
    const v = value[name];
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new BenchError(`${at}.${name} must be a number in [0, 1]`);
    out[name] = v;
  }
  return { mnemonicShare: out.mnemonicShare ?? 0, symbolicBranchShare: out.symbolicBranchShare ?? 0, symbolicPoolShare: out.symbolicPoolShare ?? 0 };
}

export function parseReadabilityFloors(value: unknown, where: string): ReadabilityFloors {
  if (!isRecord(value) || value['schema'] !== READABILITY_FLOOR_SCHEMA) throw new BenchError(`${where}: schema must be '${READABILITY_FLOOR_SCHEMA}'`);
  const roms = value['roms'];
  if (!isRecord(roms)) throw new BenchError(`${where}: roms must be an object`);
  const out: Record<string, Shares> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) out[name] = sharesFrom(roms[name], `${where}: roms.${name}`);
  return { schema: READABILITY_FLOOR_SCHEMA, roms: out };
}

/** bench/baseline/readability.json, or undefined when it is not committed yet. */
export async function readReadabilityFloors(cx: BenchContext): Promise<ReadabilityFloors | undefined> {
  const path = readabilityFloorPath(cx);
  if (!(await exists(path))) return undefined;
  return parseReadabilityFloors(await readJson(path), path);
}

export interface FloorUpdate {
  readonly floors: ReadabilityFloors;
  /** The ROMs given a floor now, in name order. */
  readonly added: readonly string[];
  /** The ROMs whose floor was already committed and is left as it is. */
  readonly kept: readonly string[];
}

/**
 * The floors after adding `measured` for every ROM that has none. An existing floor is never overwritten
 * or lowered: those ROMs are kept as committed.
 */
export function addFloors(current: ReadabilityFloors | undefined, measured: Readonly<Record<string, Shares>>): FloorUpdate {
  const roms: Record<string, Shares> = { ...(current?.roms ?? {}) };
  const added: string[] = [];
  const kept: string[] = [];
  for (const name of Object.keys(measured).sort(compareCodeUnits)) {
    const shares = measured[name];
    if (shares === undefined) continue;
    if (roms[name] !== undefined) {
      kept.push(name);
      continue;
    }
    roms[name] = shares;
    added.push(name);
  }
  const sorted: Record<string, Shares> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) {
    const shares = roms[name];
    if (shares !== undefined) sorted[name] = shares;
  }
  return { floors: { schema: READABILITY_FLOOR_SCHEMA, roms: sorted }, added, kept };
}

export async function writeReadabilityFloors(cx: BenchContext, floors: ReadabilityFloors): Promise<void> {
  await writeText(readabilityFloorPath(cx), prettyJson(floors));
}
