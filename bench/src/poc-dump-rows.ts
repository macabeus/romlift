// bench/baseline/poc-dump-rows.json (D60, review findings gate-honesty-r1-5 and code-quality-r1-4): the
// PoC's own row of each tuning ROM revealed after the PoC baseline was pinned (tmc), pinned by content as
// the baseline pins the rows of the five. That row is the ROM's PoC reference (g2.entries' floor,
// g2.extents' lost, g2.baseline-rows' diffs), and it comes from a run of the pinned PoC source on the
// dataset romlift handed it (ROMLIFT_POC_DATASET), so both are recorded: the digest of the dataset as
// handed over and the digest of the row. `bench run` and `bench poc-check` refuse a dump whose dataset or
// row differs from the pinned one; `export-poc --mode scored` checks a fresh dump against it and writes it
// only with `--pin`, so the diff of this file in Git is the review of a new reference.
import { join } from 'node:path';
import { type JsonValue, canonicalJson, compareCodeUnits } from 'romlift';
import { sha256Stream } from 'romlift/node';

import { type JsonRecord, withoutPaths } from './baseline.ts';
import { type BenchContext, baselineDir } from './context.ts';
import type { Dataset } from './dataset.ts';
import { BenchError, exists, isRecord, prettyJson, readJson } from './files.ts';

export const POC_DUMP_ROWS_SCHEMA = 'romlift-bench/poc-dump-rows@1';

/** The PoC's own row is compared on everything but its volatile seconds and the signatures (phase 6). */
export const POC_ROW_EXCLUDED: readonly string[] = ['seconds', 'signatures'];

export interface PinnedDumpRow {
  /** sha256 of the canonical JSON of the dataset handed to the PoC (pocDatasetOf). */
  readonly datasetDigest: string;
  /** sha256 of the canonical JSON of the PoC's row without POC_ROW_EXCLUDED. */
  readonly rowDigest: string;
  /** The row's true positives, for the reader of the diff. */
  readonly tp: number;
}

export interface PocDumpRows {
  readonly schema: typeof POC_DUMP_ROWS_SCHEMA;
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, PinnedDumpRow>>;
}

export const pocDumpRowsPath = (cx: BenchContext): string => join(baselineDir(cx), 'poc-dump-rows.json');

/** The dataset in the PoC's shape ({name, rom, elf, sha1, labels, untyped}), for a ROM the pinned PoC has no file of. */
export function pocDatasetOf(d: Dataset): {
  readonly name: string;
  readonly rom: string;
  readonly elf: string;
  readonly sha1: string;
  readonly labels: readonly unknown[];
  readonly untyped: readonly unknown[];
} {
  const entry = (e: {
    readonly addr: string;
    readonly name?: string;
    readonly category: string;
    readonly note?: string;
  }): unknown => ({
    addr: e.addr,
    ...(e.name === undefined ? {} : { name: e.name }),
    category: e.category,
    ...(e.note === undefined ? {} : { note: e.note }),
  });
  return {
    name: d.name,
    rom: d.rom,
    elf: d.elf,
    sha1: d.sha1,
    labels: d.labels.map(entry),
    untyped: d.untyped.map(entry),
  };
}

/** The digest of the dataset as handed to the PoC. */
export function pocDatasetDigest(d: Dataset): string {
  return sha256Stream(canonicalJson(pocDatasetOf(d) as JsonValue));
}

/** The digest of a PoC row, without its volatile fields. */
export function pocRowDigest(row: JsonRecord): string {
  return sha256Stream(canonicalJson(withoutPaths(row, POC_ROW_EXCLUDED) as JsonValue));
}

function hex64(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw new BenchError(`${where}: expected a sha256 in hex`);
  return value;
}

export function parsePocDumpRows(value: unknown, where: string): PocDumpRows {
  if (!isRecord(value) || value['schema'] !== POC_DUMP_ROWS_SCHEMA)
    throw new BenchError(`${where}: schema must be ${POC_DUMP_ROWS_SCHEMA}`);
  const roms = value['roms'];
  if (!isRecord(roms)) throw new BenchError(`${where}: roms must be an object`);
  const out: Record<string, PinnedDumpRow> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) {
    const r = roms[name];
    if (!isRecord(r) || typeof r['tp'] !== 'number')
      throw new BenchError(`${where}: roms.${name} must hold datasetDigest, rowDigest and tp`);
    out[name] = {
      datasetDigest: hex64(r['datasetDigest'], `${where}: roms.${name}.datasetDigest`),
      rowDigest: hex64(r['rowDigest'], `${where}: roms.${name}.rowDigest`),
      tp: r['tp'],
    };
  }
  return {
    schema: POC_DUMP_ROWS_SCHEMA,
    pocSourceDigest: hex64(value['pocSourceDigest'], `${where}: pocSourceDigest`),
    roms: out,
  };
}

export async function readPocDumpRows(cx: BenchContext): Promise<PocDumpRows | undefined> {
  const path = pocDumpRowsPath(cx);
  return (await exists(path)) ? parsePocDumpRows(await readJson(path), path) : undefined;
}

export function pocDumpRowsText(doc: PocDumpRows): string {
  const roms: Record<string, PinnedDumpRow> = {};
  for (const name of Object.keys(doc.roms).sort(compareCodeUnits)) {
    const r = doc.roms[name];
    if (r !== undefined) roms[name] = { datasetDigest: r.datasetDigest, rowDigest: r.rowDigest, tp: r.tp };
  }
  return prettyJson({ pocSourceDigest: doc.pocSourceDigest, roms, schema: doc.schema });
}

/**
 * Why the dump of `d` (made on the dataset with `datasetDigest`, giving `row`) is not the pinned PoC
 * reference of `d`, or undefined when it is. A dump made on the PoC's own dataset file (datasetDigest
 * null) is never a pinned dump row.
 */
export function dumpRowMismatch(
  d: Dataset,
  pinned: PocDumpRows | undefined,
  pocSourceDigest: string,
  datasetDigest: string | null,
  row: JsonRecord,
): string | undefined {
  const p = pinned?.roms[d.name];
  if (pinned === undefined || p === undefined)
    return `${d.name}: no pinned PoC row in bench/baseline/poc-dump-rows.json`;
  if (pinned.pocSourceDigest !== pocSourceDigest)
    return `${d.name}: the pinned PoC row is of PoC source ${pinned.pocSourceDigest}, the dump of ${pocSourceDigest}`;
  if (datasetDigest === null) return `${d.name}: the dump was made on the PoC's own dataset file, not on romlift's`;
  const now = pocDatasetDigest(d);
  if (datasetDigest !== now)
    return `${d.name}: the dump was made on dataset ${datasetDigest.slice(0, 12)}…, the dataset is now ${now.slice(0, 12)}…: re-run npm run export-poc -- --mode scored --only ${d.name}`;
  if (p.datasetDigest !== now)
    return `${d.name}: the pinned PoC row was made on dataset ${p.datasetDigest.slice(0, 12)}…, the dataset is now ${now.slice(0, 12)}…: re-pin with export-poc --mode scored --pin`;
  const digest = pocRowDigest(row);
  if (digest !== p.rowDigest)
    return `${d.name}: the PoC's row in the dump has digest ${digest.slice(0, 12)}…, the pinned one ${p.rowDigest.slice(0, 12)}…`;
  return undefined;
}
