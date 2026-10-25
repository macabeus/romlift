// bench/results.json (architecture §8.2): provenance in `meta`, the optional printer summary, the
// real-tier gate record, one row per tuning ROM sorted by name, the counts and verdict of every sealed
// held-out ROM (never a row, D25), and the PoC-parity evidence once milestone M1 records it. It holds no
// timestamp and no machine data; those go to bench/timings.json.
import { compareCodeUnits, isMissReason, isOrigin } from 'romlift';
import { parseCorpusSummary, type CorpusSummary } from 'romlift/internal';

import { BenchError, exists, isRecord, prettyJson, readJson, writeText } from './files.ts';
import { parseParityEvidence, type ParityEvidence } from './parity-evidence.ts';
import type { ObjdiffExample, ObjdiffSummary } from './objdiff.ts';
import { SHARE_NAMES, type ReadabilityMember, type Shares } from './readability.ts';
import type { BaselineRows, BenchRow, ExtentRow, FalseRow, MissRow, PocSource, RowDiff, StaleException } from './row.ts';
import type { InitBuildVerdict } from './scaffold.ts';
import { assertCountsOnly, type SealedCounts } from './seal.ts';
import type { LibraryPlacements, SignaturesMember } from './signatures.ts';
import { isArtifactCategory, type ArtifactCategory } from './vocabulary.ts';

export interface RomInputs {
  readonly sha1: string;
  readonly elfSha256: string;
  /** The reference objects' digest, when the run compared with them (`--scaffold`, the objdiff family). */
  readonly objectsDigest?: string;
}

export interface Toolchain {
  readonly as: string | null;
  readonly ld: string | null;
  readonly objcopy: string | null;
  /** objdiff-cli's version (from phase 3; absent in an older artifact). */
  readonly objdiff?: string | null;
}

/** One measured command of the memory family (bench/src/large-rom.ts): its exit code and peak RSS. */
export interface MemoryRun {
  readonly command: string;
  readonly exitCode: number;
  readonly maxRssMiB: number;
  /** The `--max-old-space-size` the command ran under (null: none); absent in artifacts written before fix round 4 of phase 3. */
  readonly maxOldSpaceSizeMiB?: number | null;
  readonly treeDigest?: string;
}

/** The memory family (architecture §8.4, g3.large-rom): the 32 MiB synthetic ROM and each command's peak RSS. */
export interface MemoryMember {
  readonly romBytes: number;
  readonly sha1: string;
  readonly runs: readonly MemoryRun[];
}

export interface ResultsMeta {
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly sourceDigest: string;
  readonly nodeMajor: number;
  readonly romliftVersion: string;
  /** Per ROM its inputs, plus `pocSourceDigest` and, when the signatures family ran (phase 6), `signaturesDigest`. */
  readonly inputs: Readonly<Record<string, RomInputs | string>>;
  readonly toolchain: Toolchain;
  /** Per ROM, the metric families that ran, sorted. */
  readonly families: Readonly<Record<string, readonly string[]>>;
  /** Where the rows come from: the PoC's dumps in phase 1, romlift's own analysis from phase 2. */
  readonly source: 'poc' | 'romlift';
  /** The analysis profile the rows were scored with (romlift rows). */
  readonly profile?: string;
}

/**
 * One sealed held-out ROM in results.json: its counts and whether it passes (D25); never an address or a name. With
 * `bench run --scaffold` (phase 4) also `init`, its build through init, setup.sh and make: exit codes and a boolean.
 */
export type SealedEntry = SealedCounts & { readonly pass: boolean; readonly init?: InitBuildVerdict };

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
  /** The memory family (from phase 3), written by a lead run. */
  readonly memory?: MemoryMember;
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

function sharesAt(value: unknown, at: string): Shares {
  const r = rec(value, at);
  const [m, b, p] = SHARE_NAMES.map((name) => num(r[name], `${at}.${name}`));
  return { mnemonicShare: m ?? 0, symbolicBranchShare: b ?? 0, symbolicPoolShare: p ?? 0 };
}

function readabilityField(value: unknown, at: string): ReadabilityMember {
  const r = rec(value, at);
  return { ...sharesAt(r, at), floor: r['floor'] === null ? null : sharesAt(r['floor'], `${at}.floor`) };
}

function objdiffExample(value: unknown, at: string): ObjdiffExample {
  const r = rec(value, at);
  return { function: str(r['function'], `${at}.function`), kind: str(r['kind'], `${at}.kind`), detail: str(r['detail'], `${at}.detail`) };
}

function objdiffField(value: unknown, at: string): ObjdiffSummary {
  const r = rec(value, at);
  const differences: Record<string, number> = {};
  for (const [kind, count] of Object.entries(rec(r['differences'], `${at}.differences`))) differences[kind] = num(count, `${at}.differences.${kind}`);
  return { linked: bool(r['linked'], `${at}.linked`), scored: num(r['scored'], `${at}.scored`), differences, examples: list(r['examples'], `${at}.examples`, objdiffExample) };
}

function libraryPlacementsAt(value: unknown, at: string): LibraryPlacements {
  const r = rec(value, at);
  return { library: str(r['library'], `${at}.library`), version: str(r['version'], `${at}.version`), functions: num(r['functions'], `${at}.functions`), objects: num(r['objects'], `${at}.objects`) };
}

/** The counts `keys` names of the record at `at`, each a number. */
function countsAt<K extends string>(value: unknown, at: string, keys: readonly K[]): Record<K, number> {
  const r = rec(value, at);
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = num(r[k], `${at}.${k}`);
  return out;
}

/** The signatures family of a romlift row (phase 6, signatures.ts SignaturesMember). */
function signaturesField(value: unknown, at: string): SignaturesMember {
  const r = rec(value, at);
  const names = rec(r['names'], `${at}.names`);
  return {
    libraries: list(r['libraries'], `${at}.libraries`, libraryPlacementsAt),
    placements: countsAt(r['placements'], `${at}.placements`, ['total', 'atElfFunc', 'atUntyped', 'wrong']),
    tables: countsAt(r['tables'], `${at}.tables`, ['total', 'objectOfSize', 'label', 'wrong']),
    sizes: countsAt(r['sizes'], `${at}.sizes`, ['proposed', 'equal', 'differ', 'unjudged']),
    names: { reference: bool(names['reference'], `${at}.names.reference`), ...countsAt(names, `${at}.names`, ['total', 'equal', 'differ', 'reviewed']) },
  };
}

/** The optional phase-3 fields of a romlift row. */
function emissionFields(r: Readonly<Record<string, unknown>>, at: string): Partial<Pick<BenchRow, 'readability' | 'objdiff' | 'treeDigest'>> {
  return {
    ...(r['readability'] === undefined ? {} : { readability: readabilityField(r['readability'], `${at}.readability`) }),
    ...(r['objdiff'] === undefined ? {} : { objdiff: objdiffField(r['objdiff'], `${at}.objdiff`) }),
    ...(r['treeDigest'] === undefined ? {} : { treeDigest: str(r['treeDigest'], `${at}.treeDigest`) }),
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
    ...(scaffold === undefined
      ? {}
      : { scaffold: { ok: bool(scaffold['ok'], `${at}.scaffold.ok`), ...(scaffold['init'] === undefined ? {} : { init: initVerdictField(scaffold['init'], `${at}.scaffold.init`) }) } }),
    ...romliftFields(r, at),
    ...emissionFields(r, at),
    ...(r['signatures'] === undefined ? {} : { signatures: signaturesField(r['signatures'], `${at}.signatures`) }),
  };
}

/** meta.inputs: per ROM its {sha1, elfSha256}, plus the `pocSourceDigest` and `signaturesDigest` strings. */
function parseInputs(value: unknown, at: string): Readonly<Record<string, RomInputs | string>> {
  const out: Record<string, RomInputs | string> = {};
  for (const [key, entry] of Object.entries(rec(value, at))) {
    if (typeof entry === 'string') out[key] = entry;
    else {
      const r = rec(entry, `${at}.${key}`);
      out[key] = {
        sha1: str(r['sha1'], `${at}.${key}.sha1`),
        elfSha256: str(r['elfSha256'], `${at}.${key}.elfSha256`),
        ...(r['objectsDigest'] === undefined ? {} : { objectsDigest: str(r['objectsDigest'], `${at}.${key}.objectsDigest`) }),
      };
    }
  }
  return out;
}

function parsePrinter(value: unknown, where: string): CorpusSummary {
  const parsed = parseCorpusSummary(value);
  if (!parsed.ok) fail(`${where}: printer`, parsed.error);
  return parsed.value;
}

function memoryRun(value: unknown, at: string): MemoryRun {
  const r = rec(value, at);
  return {
    command: str(r['command'], `${at}.command`),
    exitCode: num(r['exitCode'], `${at}.exitCode`),
    maxRssMiB: num(r['maxRssMiB'], `${at}.maxRssMiB`),
    ...(r['maxOldSpaceSizeMiB'] === undefined ? {} : { maxOldSpaceSizeMiB: r['maxOldSpaceSizeMiB'] === null ? null : num(r['maxOldSpaceSizeMiB'], `${at}.maxOldSpaceSizeMiB`) }),
    ...(r['treeDigest'] === undefined ? {} : { treeDigest: str(r['treeDigest'], `${at}.treeDigest`) }),
  };
}

export function parseMemory(value: unknown, at: string): MemoryMember {
  const r = rec(value, at);
  return { romBytes: num(r['romBytes'], `${at}.romBytes`), sha1: str(r['sha1'], `${at}.sha1`), runs: list(r['runs'], `${at}.runs`, memoryRun) };
}

function gluedWhereOf(r: Record<string, unknown>, at: string): NonNullable<SealedEntry['gluedWhere']> {
  return { insideExtent: num(r['insideExtent'], `${at}.insideExtent`), outsideExtents: num(r['outsideExtents'], `${at}.outsideExtents`), pastCodeEnd: num(r['pastCodeEnd'], `${at}.pastCodeEnd`) };
}

/** An init build's verdict (bench run --scaffold, phase 4): three exit codes and whether the built ROM matched. */
function initVerdictField(value: unknown, at: string): InitBuildVerdict {
  const r = rec(value, at);
  return { initExit: num(r['initExit'], `${at}.initExit`), setupExit: num(r['setupExit'], `${at}.setupExit`), makeExit: num(r['makeExit'], `${at}.makeExit`), sha1Match: bool(r['sha1Match'], `${at}.sha1Match`) };
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
    ...(r['init'] === undefined ? {} : { init: initVerdictField(r['init'], `${at}.init`) }),
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
      toolchain: { as: tool('as'), ld: tool('ld'), objcopy: tool('objcopy'), ...('objdiff' in toolchain ? { objdiff: tool('objdiff') } : {}) },
      families,
      source,
      ...(typeof meta['profile'] === 'string' ? { profile: meta['profile'] } : {}),
    },
    ...(value['printer'] === undefined ? {} : { printer: parsePrinter(value['printer'], where) }),
    ...(value['memory'] === undefined ? {} : { memory: parseMemory(value['memory'], `${where}: memory`) }),
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
    ...(results.memory === undefined ? {} : { memory: results.memory }),
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
