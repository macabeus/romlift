// bench/results.json (architecture §8.2): provenance in `meta`, the optional printer summary, the
// real-tier gate record, one row per tuning ROM sorted by name, the counts and verdict of every sealed
// held-out ROM (never a row, D25), and the PoC-parity evidence once milestone M1 records it. It holds no
// timestamp and no machine data; those go to bench/timings.json.
import { compareCodeUnits, isMissReason, isOrigin } from 'romlift';
import { parseCorpusSummary, type CorpusSummary } from 'romlift/internal';

import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';
import { parseParityEvidence, type ParityEvidence } from './parity-evidence.ts';
import type { BaselineRows, BenchRow, ExtentRow, FalseRow, MissRow, PocSource, RowDiff, StaleException } from './row.ts';
import { assertCountsOnly, type SealedCounts } from './seal.ts';
import { isArtifactCategory, type ArtifactCategory } from './vocabulary.ts';

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
  /** Where the rows come from: the PoC's dumps in phase 1, romlift's own analysis from phase 2. */
  readonly source: 'poc' | 'romlift';
  /** The analysis profile the rows were scored with (romlift rows). */
  readonly profile?: string;
}

/** One sealed held-out ROM in results.json: its counts and whether it passes (D25); never an address or a name. */
export type SealedEntry = SealedCounts & { readonly pass: boolean };

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
  readonly printer?: CorpusSummary;
  readonly gates: { readonly real: readonly GateEntry[] };
  readonly roms: readonly BenchRow[];
  /** The sealed held-out ROMs, counts and verdicts only. */
  readonly sealed?: readonly SealedEntry[];
  /** The PoC-parity evidence (milestone M1, g2.poc-parity), kept as written once the run cannot recompute it. */
  readonly parity?: ParityEvidence;
}

function fail(where: string, what: string): never {
  throw new BenchError(`${where}: ${what}`);
}

// Field readers: each returns the typed value or throws a BenchError naming the field.
function str(value: unknown, at: string): string {
  if (typeof value !== 'string') fail(at, 'must be a string');
  return value;
}

function num(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(at, 'must be a number');
  return value;
}

function bool(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') fail(at, 'must be a boolean');
  return value;
}

function rec(value: unknown, at: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(at, 'must be an object');
  return value;
}

function list<T>(value: unknown, at: string, item: (v: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) fail(at, 'must be an array');
  return value.map((v, i) => item(v, `${at}[${i}]`));
}

function category(r: Readonly<Record<string, unknown>>, at: string): { readonly category?: ArtifactCategory } {
  if (r['category'] === undefined) return {};
  const id = str(r['category'], `${at}.category`);
  if (!isArtifactCategory(id)) fail(`${at}.category`, `'${id}' is not an exception category`);
  return { category: id };
}

function missRow(value: unknown, at: string): MissRow {
  const r = rec(value, at);
  const reason = str(r['reason'], `${at}.reason`);
  if (!isMissReason(reason)) fail(`${at}.reason`, `'${reason}' is not a miss reason`);
  return { addr: str(r['addr'], `${at}.addr`), name: str(r['name'], `${at}.name`), size: num(r['size'], `${at}.size`), reason, listed: bool(r['listed'], `${at}.listed`), ...category(r, at) };
}

function falseRow(value: unknown, at: string): FalseRow {
  const r = rec(value, at);
  const origin = str(r['origin'], `${at}.origin`);
  if (!isOrigin(origin)) fail(`${at}.origin`, `'${origin}' is not an origin`);
  return {
    addr: str(r['addr'], `${at}.addr`),
    origin,
    size: num(r['size'], `${at}.size`),
    ...(r['owner'] === undefined ? {} : { owner: str(r['owner'], `${at}.owner`) }),
    listed: bool(r['listed'], `${at}.listed`),
    ...category(r, at),
  };
}

function extentRow(value: unknown, at: string): ExtentRow {
  const r = rec(value, at);
  return { addr: str(r['addr'], `${at}.addr`), name: str(r['name'], `${at}.name`), elf: num(r['elf'], `${at}.elf`), found: num(r['found'], `${at}.found`) };
}

function staleRow(value: unknown, at: string): StaleException {
  const r = rec(value, at);
  const list = str(r['list'], `${at}.list`);
  if (list !== 'labels' && list !== 'untyped') fail(`${at}.list`, 'must be labels or untyped');
  return { list, addr: str(r['addr'], `${at}.addr`) };
}

function diffRow(value: unknown, at: string): RowDiff {
  const r = rec(value, at);
  return { kind: str(r['kind'], `${at}.kind`), addr: str(r['addr'], `${at}.addr`) };
}

function baselineRows(value: unknown, at: string): BaselineRows {
  const r = rec(value, at);
  return { diffs: list(r['diffs'], `${at}.diffs`, diffRow), unaccepted: list(r['unaccepted'], `${at}.unaccepted`, diffRow), staleAccepted: list(r['staleAccepted'], `${at}.staleAccepted`, diffRow) };
}

/** A row's PoC reference: its true positives, and since D60 where they come from (absent in an older artifact). */
function pocField(p: Readonly<Record<string, unknown>>, at: string): { readonly tp: number; readonly source?: PocSource } {
  const source = p['source'];
  if (source !== undefined && source !== 'baseline' && source !== 'dump' && source !== 'none') throw new BenchError(`${at}.source must be baseline, dump or none`);
  return { tp: num(p['tp'], `${at}.tp`), ...(source === undefined ? {} : { source }) };
}

/** The optional phase-2 fields of a romlift row; a PoC-sourced row has none. */
function romliftFields(r: Readonly<Record<string, unknown>>, at: string): Partial<Pick<BenchRow, 'analysisDigest' | 'poc' | 'staleExceptions' | 'baselineRows' | 'parity'>> {
  const parity = r['parity'] === undefined ? undefined : rec(r['parity'], `${at}.parity`);
  return {
    ...(r['analysisDigest'] === undefined ? {} : { analysisDigest: str(r['analysisDigest'], `${at}.analysisDigest`) }),
    ...(r['poc'] === undefined ? {} : { poc: pocField(rec(r['poc'], `${at}.poc`), `${at}.poc`) }),
    ...(r['staleExceptions'] === undefined ? {} : { staleExceptions: list(r['staleExceptions'], `${at}.staleExceptions`, staleRow) }),
    ...(r['baselineRows'] === undefined ? {} : { baselineRows: baselineRows(r['baselineRows'], `${at}.baselineRows`) }),
    ...(parity === undefined ? {} : { parity: { digest: str(parity['digest'], `${at}.parity.digest`), expected: str(parity['expected'], `${at}.parity.expected`) } }),
  };
}

/** One row of results.json, every field checked against BenchRow. */
export function parseRow(value: unknown, where: string): BenchRow {
  const r = rec(value, where);
  const at = `${where}: row ${typeof r['name'] === 'string' ? r['name'] : '?'}`;
  const startup = rec(r['startup'], `${at}.startup`);
  const extents = rec(r['extents'], `${at}.extents`);
  const codeEnd = rec(r['codeEnd'], `${at}.codeEnd`);
  const scaffold = r['scaffold'] === undefined ? undefined : rec(r['scaffold'], `${at}.scaffold`);
  return {
    name: str(r['name'], `${at}.name`),
    sha1: str(r['sha1'], `${at}.sha1`),
    elfCommit: r['elfCommit'] === null ? null : str(r['elfCommit'], `${at}.elfCommit`),
    elfFunctions: num(r['elfFunctions'], `${at}.elfFunctions`),
    entries: num(r['entries'], `${at}.entries`),
    startup: { end: str(startup['end'], `${at}.startup.end`), pieces: num(startup['pieces'], `${at}.startup.pieces`), elfFunctions: num(startup['elfFunctions'], `${at}.startup.elfFunctions`) },
    thumb: num(r['thumb'], `${at}.thumb`),
    arm: num(r['arm'], `${at}.arm`),
    tp: num(r['tp'], `${at}.tp`),
    precision: num(r['precision'], `${at}.precision`),
    recall: num(r['recall'], `${at}.recall`),
    misses: list(r['misses'], `${at}.misses`, missRow),
    falseEntries: list(r['falseEntries'], `${at}.falseEntries`, falseRow),
    extents: {
      sized: num(extents['sized'], `${at}.extents.sized`),
      agree: num(extents['agree'], `${at}.extents.agree`),
      mismatches: list(extents['mismatches'], `${at}.extents.mismatches`, extentRow),
      ...(extents['lost'] === undefined ? {} : { lost: list(extents['lost'], `${at}.extents.lost`, extentRow) }),
    },
    codeEnd: { found: str(codeEnd['found'], `${at}.codeEnd.found`), elf: str(codeEnd['elf'], `${at}.codeEnd.elf`), delta: num(codeEnd['delta'], `${at}.codeEnd.delta`) },
    deterministic: bool(r['deterministic'], `${at}.deterministic`),
    ...(scaffold === undefined ? {} : { scaffold: { ok: bool(scaffold['ok'], `${at}.scaffold.ok`) } }),
    ...romliftFields(r, at),
  };
}

/** meta.inputs: per ROM its {sha1, elfSha256}, plus the `pocSourceDigest` string. */
function parseInputs(value: unknown, at: string): Readonly<Record<string, RomInputs | string>> {
  const out: Record<string, RomInputs | string> = {};
  for (const [key, entry] of Object.entries(rec(value, at))) {
    if (typeof entry === 'string') out[key] = entry;
    else {
      const r = rec(entry, `${at}.${key}`);
      out[key] = { sha1: str(r['sha1'], `${at}.${key}.sha1`), elfSha256: str(r['elfSha256'], `${at}.${key}.elfSha256`) };
    }
  }
  return out;
}

function parsePrinter(value: unknown, where: string): CorpusSummary {
  const parsed = parseCorpusSummary(value);
  if (!parsed.ok) fail(`${where}: printer`, parsed.error);
  return parsed.value;
}

function gluedWhereOf(r: Record<string, unknown>, at: string): NonNullable<SealedEntry['gluedWhere']> {
  return { insideExtent: num(r['insideExtent'], `${at}.insideExtent`), outsideExtents: num(r['outsideExtents'], `${at}.outsideExtents`), pastCodeEnd: num(r['pastCodeEnd'], `${at}.pastCodeEnd`) };
}

/** One sealed entry: counts only (assertCountsOnly) with every count and the verdict present (`other` and `gluedWhere` only from the phase-2 fix round on). */
function parseSealed(value: unknown, at: string): SealedEntry {
  try {
    assertCountsOnly(value);
  } catch (error) {
    fail(at, error instanceof Error ? error.message : String(error));
  }
  const r = rec(value, at);
  const falseEntries = rec(r['falseEntries'], `${at}.falseEntries`);
  const extents = rec(r['extents'], `${at}.extents`);
  return {
    name: str(r['name'], `${at}.name`),
    entries: num(r['entries'], `${at}.entries`),
    elfFunctions: num(r['elfFunctions'], `${at}.elfFunctions`),
    tp: num(r['tp'], `${at}.tp`),
    glued: num(r['glued'], `${at}.glued`),
    ...(r['gluedWhere'] === undefined ? {} : { gluedWhere: gluedWhereOf(rec(r['gluedWhere'], `${at}.gluedWhere`), `${at}.gluedWhere`) }),
    labelCandidates: num(r['labelCandidates'], `${at}.labelCandidates`),
    falseEntries: {
      startup: num(falseEntries['startup'], `${at}.falseEntries.startup`),
      veneer: num(falseEntries['veneer'], `${at}.falseEntries.veneer`),
      adrCallback: num(falseEntries['adrCallback'], `${at}.falseEntries.adrCallback`),
      insideElfFunction: num(falseEntries['insideElfFunction'], `${at}.falseEntries.insideElfFunction`),
      ...(falseEntries['other'] === undefined ? {} : { other: num(falseEntries['other'], `${at}.falseEntries.other`) }),
    },
    extents: { sized: num(extents['sized'], `${at}.extents.sized`), agree: num(extents['agree'], `${at}.extents.agree`) },
    codeEnd: { delta: num(rec(r['codeEnd'], `${at}.codeEnd`)['delta'], `${at}.codeEnd.delta`) },
    pass: bool(r['pass'], `${at}.pass`),
  };
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
  if (!isRecord(meta['families'])) fail(where, 'meta.families must be an object');
  const families: Record<string, string[]> = {};
  for (const [rom, list] of Object.entries(meta['families'])) {
    if (!Array.isArray(list) || !list.every((f) => typeof f === 'string')) fail(where, `meta.families.${rom} must be a list of names`);
    families[rom] = list.filter((f): f is string => typeof f === 'string');
  }
  const toolchain = isRecord(meta['toolchain']) ? meta['toolchain'] : {};
  const tool = (k: string): string | null => (typeof toolchain[k] === 'string' ? toolchain[k] : null);
  const gates = value['gates'];
  const real = isRecord(gates) && Array.isArray(gates['real']) ? gates['real'] : [];
  const roms = value['roms'];
  if (!Array.isArray(roms)) fail(where, 'roms must be an array');
  const source = meta['source'] === 'romlift' ? 'romlift' : 'poc';
  const parity = value['parity'] === undefined ? undefined : parseParityEvidence(value['parity'], `${where}: parity`);
  return {
    meta: {
      commit: typeof meta['commit'] === 'string' ? meta['commit'] : null,
      dirty: meta['dirty'] === true,
      sourceDigest: meta['sourceDigest'],
      nodeMajor: meta['nodeMajor'],
      romliftVersion: typeof meta['romliftVersion'] === 'string' ? meta['romliftVersion'] : '',
      inputs: parseInputs(meta['inputs'], `${where}: meta.inputs`),
      toolchain: { as: tool('as'), ld: tool('ld'), objcopy: tool('objcopy') },
      families,
      source,
      ...(typeof meta['profile'] === 'string' ? { profile: meta['profile'] } : {}),
    },
    ...(value['printer'] === undefined ? {} : { printer: parsePrinter(value['printer'], where) }),
    gates: { real: real.map((g, i) => parseGateEntry(g, `${where}: gates.real[${i}]`)) },
    roms: roms.map((r, i) => parseRow(r, `${where}: roms[${i}]`)),
    ...(value['sealed'] === undefined ? {} : { sealed: list(value['sealed'], `${where}: sealed`, parseSealed) }),
    ...(parity === undefined ? {} : { parity }),
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

/** The artifact text: rows and sealed entries by name, gate records by id, two-space JSON. */
export function resultsText(results: Results): string {
  const sorted: Results = {
    meta: results.meta,
    ...(results.printer === undefined ? {} : { printer: results.printer }),
    gates: { real: [...results.gates.real].sort((a, b) => compareCodeUnits(a.id, b.id)) },
    roms: [...results.roms].sort((a, b) => compareCodeUnits(a.name, b.name)),
    ...(results.sealed === undefined ? {} : { sealed: [...results.sealed].sort((a, b) => compareCodeUnits(a.name, b.name)) }),
    ...(results.parity === undefined ? {} : { parity: results.parity }),
  };
  return prettyJson(sorted);
}

export async function writeResultsFile(path: string, results: Results): Promise<void> {
  await writeText(path, resultsText(results));
}
