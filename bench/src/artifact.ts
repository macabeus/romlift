// bench/results.json (architecture §8.2): provenance in `meta`, the optional printer summary, the
// real-tier gate record and one row per tuning ROM sorted by name. It holds no timestamp and no
// machine data; those go to bench/timings.json.
import { compareCodeUnits } from 'romlift';

import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';
import type { BenchRow } from './row.ts';

export interface RomInputs {
  readonly sha1: string;
  readonly elfSha256: string;
}

export interface Toolchain {
  readonly as: string | null;
  readonly ld: string | null;
  readonly objcopy: string | null;
}

export interface ResultsMeta {
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly sourceDigest: string;
  readonly nodeMajor: number;
  readonly romliftVersion: string;
  /** Per ROM its inputs, plus `pocSourceDigest`. */
  readonly inputs: Readonly<Record<string, RomInputs | string>>;
  readonly toolchain: Toolchain;
  /** Per ROM, the metric families that ran, sorted. */
  readonly families: Readonly<Record<string, readonly string[]>>;
  /** Where the rows come from: the PoC's dumps in phase 1. */
  readonly source: 'poc';
}

/** One real-tier gate verdict, as `bench gates --tier real` records it. */
export interface GateEntry {
  readonly id: string;
  readonly verdict: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly detail: string;
}

export interface Results {
  readonly meta: ResultsMeta;
  /** bench/.local/corpus/summary.json when current; absent otherwise. */
  readonly printer?: unknown;
  readonly gates: { readonly real: readonly GateEntry[] };
  readonly roms: readonly BenchRow[];
}

function fail(where: string, what: string): never {
  throw new BenchError(`${where}: ${what}`);
}

function parseRow(value: unknown, where: string): BenchRow {
  if (!isRecord(value) || typeof value['name'] !== 'string') fail(where, 'a row has no name');
  const at = `${where}: row ${value['name']}`;
  for (const key of ['tp', 'entries', 'elfFunctions'] as const) if (typeof value[key] !== 'number') fail(at, `${key} must be a number`);
  for (const key of ['misses', 'falseEntries'] as const) if (!Array.isArray(value[key])) fail(at, `${key} must be an array`);
  const extents = value['extents'];
  if (!isRecord(extents) || !Array.isArray(extents['mismatches'])) fail(at, 'extents.mismatches must be an array');
  const codeEnd = value['codeEnd'];
  if (!isRecord(codeEnd) || typeof codeEnd['delta'] !== 'number') fail(at, 'codeEnd.delta must be a number');
  if (typeof value['deterministic'] !== 'boolean') fail(at, 'deterministic must be a boolean');
  return value as unknown as BenchRow;
}

function parseGateEntry(value: unknown, where: string): GateEntry {
  if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['verdict'] !== 'string') fail(where, 'a gate record has no id or verdict');
  const inputs: Record<string, string> = {};
  if (isRecord(value['inputs'])) for (const [k, v] of Object.entries(value['inputs'])) if (typeof v === 'string') inputs[k] = v;
  return { id: value['id'], verdict: value['verdict'], inputs, detail: typeof value['detail'] === 'string' ? value['detail'] : '' };
}

export function parseResults(value: unknown, where: string): Results {
  if (!isRecord(value)) fail(where, 'not a JSON object');
  const meta = value['meta'];
  if (!isRecord(meta)) fail(where, 'no meta');
  if (typeof meta['sourceDigest'] !== 'string') fail(where, 'meta.sourceDigest must be a string');
  if (typeof meta['nodeMajor'] !== 'number') fail(where, 'meta.nodeMajor must be a number');
  if (!isRecord(meta['inputs'])) fail(where, 'meta.inputs must be an object');
  if (!isRecord(meta['families'])) fail(where, 'meta.families must be an object');
  const families: Record<string, string[]> = {};
  for (const [rom, list] of Object.entries(meta['families'])) {
    if (!Array.isArray(list) || !list.every((f) => typeof f === 'string')) fail(where, `meta.families.${rom} must be a list of names`);
    families[rom] = list as string[];
  }
  const toolchain = isRecord(meta['toolchain']) ? meta['toolchain'] : {};
  const tool = (k: string): string | null => (typeof toolchain[k] === 'string' ? toolchain[k] : null);
  const gates = value['gates'];
  const real = isRecord(gates) && Array.isArray(gates['real']) ? gates['real'] : [];
  const roms = value['roms'];
  if (!Array.isArray(roms)) fail(where, 'roms must be an array');
  return {
    meta: {
      commit: typeof meta['commit'] === 'string' ? meta['commit'] : null,
      dirty: meta['dirty'] === true,
      sourceDigest: meta['sourceDigest'],
      nodeMajor: meta['nodeMajor'],
      romliftVersion: typeof meta['romliftVersion'] === 'string' ? meta['romliftVersion'] : '',
      inputs: meta['inputs'] as Record<string, RomInputs | string>,
      toolchain: { as: tool('as'), ld: tool('ld'), objcopy: tool('objcopy') },
      families,
      source: 'poc',
    },
    ...(value['printer'] === undefined ? {} : { printer: value['printer'] }),
    gates: { real: real.map((g, i) => parseGateEntry(g, `${where}: gates.real[${i}]`)) },
    roms: roms.map((r, i) => parseRow(r, `${where}: roms[${i}]`)),
  };
}

export async function readResultsFile(path: string): Promise<Results | undefined> {
  if (!(await exists(path))) return undefined;
  return parseResults(await readJson(path), path);
}

export function parseResultsText(text: string, where: string): Results {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new BenchError(`${where}: not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseResults(value, where);
}

/** The artifact text: rows by name and gate records by id, two-space JSON. */
export function resultsText(results: Results): string {
  const sorted: Results = {
    meta: results.meta,
    ...(results.printer === undefined ? {} : { printer: results.printer }),
    gates: { real: [...results.gates.real].sort((a, b) => compareCodeUnits(a.id, b.id)) },
    roms: [...results.roms].sort((a, b) => compareCodeUnits(a.name, b.name)),
  };
  return prettyJson(sorted);
}

export async function writeResultsFile(path: string, results: Results): Promise<void> {
  await writeText(path, resultsText(results));
}
