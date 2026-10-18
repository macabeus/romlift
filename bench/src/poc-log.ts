// The PoC's lockstep log (architecture §4.5, D48), written by `export-poc --mode queries` to the
// gitignored bench/.local/poc/<rom>/: queries.ndjson, every rule-level call the PoC's Analyzer made
// in one run, and readings.ndjson, every distinct Func those calls returned. This module freezes both
// formats, gives the type of every record and result, and reads them line by line, validating each
// record and resolving its reading keys. The lockstep oracle that replayed it was deleted in the fix
// round of phase 2 (D59); `export-poc --mode queries` still re-reads every log it writes through this
// reader, so the archived logs stay well formed. The method names and argument units are the PoC's own.
//
// queries.ndjson
//   line 1   {schema: 'romlift-bench/poc-queries@1', rom, sha1, pocSourceDigest, readings: 'readings.ndjson'}
//   line k+2 {seq: k, parent, epoch, method, args, result}, one per call, in the order the calls began.
//            parent is the seq of the innermost recorded call that was running when this one began,
//            or null; methods the log does not record (accept, grow, fillGaps, absorbRun, …) are
//            transparent. epoch starts at 0 and is incremented by every forgetCandidates call, whose
//            own record carries the new epoch. args are exactly what the PoC's method received, a Func
//            argument written as its entry (see POC_METHODS for the unit of each); a Func result is
//            written as {reading: <key>} (the reading the method returned, as it stood on return).
//
// readings.ndjson
//   one line {key, reading} per distinct reading, key = sha256 of the canonical JSON of `reading` as
//   written. A reading is one PoC Func: {entry, mode, insnRuns, pools, tables, calls, blSites,
//   deadEnd, balance, returns, errors, veneers, adrs, tails, tailExits, codeEnd, end}. insnRuns is the
//   run-length form of the Func's instructions: [start, len, count] stands for `count` instructions of
//   `len` bytes at start, start + len, …; the reader expands it to `insns`, one [addr, len] per
//   instruction, ascending. pools [[addr, value]], tables [[base, [targets…]]], deadEnd, veneers, adrs
//   and tails are ascending; calls ([[target, mode, site]]) are in the order of the PoC's `calls`
//   getter; blSites ([[site, target]]), balance and errors ([[reason, at]]) in the PoC's order.
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

import { canonicalJson, type JsonValue, type Mode } from 'romlift';
import { sha256Stream } from 'romlift/node';

import type { BenchContext } from './context.ts';
import { BenchError, isRecord } from './files.ts';

export const QUERIES_SCHEMA = 'romlift-bench/poc-queries@1';
export const READINGS_FILE = 'readings.ndjson';

export const queriesPath = (cx: BenchContext, rom: string): string => join(cx.repoRoot, 'bench', '.local', 'poc', rom, 'queries.ndjson');

/**
 * The unit of an argument: `bus` is a GBA bus address (0x08000000 is the first ROM byte), `offset` a
 * ROM offset (bus address − 0x08000000), `text` a string the PoC passes verbatim.
 */
export type ArgUnit = 'bus' | 'offset' | 'text';

/** The shape of a recorded result (resolved by the reader; see PocQuery for the types). */
export type ResultShape =
  | 'boolean'
  | 'text-or-null'
  | 'settled'
  | 'reading'
  | 'reading-or-null'
  | 'arm-ahead'
  | 'offset-or-null'
  | 'candidates'
  | 'null'
  | 'claim';

export interface MethodSpec {
  readonly args: readonly ArgUnit[];
  readonly result: ResultShape;
}

/** The method -> unit table: every recorded method of the PoC's Analyzer, its arguments and its result. */
export const POC_METHODS = {
  /** valid(entry): the memoised validity. */
  valid: { args: ['bus'], result: 'boolean' },
  /** whyInvalid(entry): the first failure text, verbatim, or null. */
  whyInvalid: { args: ['bus'], result: 'text-or-null' },
  /** settle(entry): the reading and its final far and noret bl sites. */
  settle: { args: ['bus'], result: 'settled' },
  /** couldBeCode(target). */
  couldBeCode: { args: ['bus'], result: 'boolean' },
  /** acceptable(f, why): written as [f.entry, why]. */
  acceptable: { args: ['bus', 'text'], result: 'boolean' },
  /** inPointerTable(entry). */
  inPointerTable: { args: ['bus'], result: 'boolean' },
  /** thumbCandidate(entry, lo, hi): lo and hi bound the gap. */
  thumbCandidate: { args: ['bus', 'offset', 'offset'], result: 'reading-or-null' },
  /** armAhead(p, end): [at (an offset), reading] or null. */
  armAhead: { args: ['offset', 'offset'], result: 'arm-ahead' },
  /** holeHead(entry, hi). */
  holeHead: { args: ['bus', 'offset'], result: 'reading-or-null' },
  /** tryTiledHole(entry, hi): non-null when it accepted the head. */
  tryTiledHole: { args: ['bus', 'offset'], result: 'reading-or-null' },
  /** absorbBlock(p, start, end): the absorbed block's end (an offset), or null. */
  absorbBlock: { args: ['offset', 'offset', 'offset'], result: 'offset-or-null' },
  /** pointerCandidates(): the pool and data candidate entries. */
  pointerCandidates: { args: [], result: 'candidates' },
  /** analyzeArm(entry). */
  analyzeArm: { args: ['bus'], result: 'reading' },
  /** forgetCandidates(): the epoch marker. */
  forgetCandidates: { args: [], result: 'null' },
  /** claim(f): written as [f.entry]; the acceptance and absorb sequence. */
  claim: { args: ['bus'], result: 'claim' },
} as const satisfies Readonly<Record<string, MethodSpec>>;

export type PocMethod = keyof typeof POC_METHODS;

export function isPocMethod(name: string): name is PocMethod {
  return Object.hasOwn(POC_METHODS, name);
}

// ---------------------------------------------------------------- readings

/** One PoC Func as it stood when a recorded call returned it (insns expanded from insnRuns). */
export interface PocReading {
  readonly entry: number;
  readonly mode: Mode;
  readonly insns: ReadonlyArray<readonly [addr: number, len: number]>;
  readonly pools: ReadonlyArray<readonly [addr: number, value: number]>;
  readonly tables: ReadonlyArray<readonly [base: number, targets: readonly number[]]>;
  readonly calls: ReadonlyArray<readonly [target: number, mode: Mode, site: number]>;
  readonly blSites: ReadonlyArray<readonly [site: number, target: number]>;
  readonly deadEnd: readonly number[];
  readonly balance: readonly number[];
  readonly returns: number;
  readonly errors: ReadonlyArray<readonly [reason: string, at: number]>;
  readonly veneers: readonly number[];
  readonly adrs: readonly number[];
  readonly tails: readonly number[];
  readonly tailExits: number;
  readonly codeEnd: number;
  readonly end: number;
}

/** A resolved reading result: the key the log names and the reading it names. */
export interface ReadingRef {
  readonly key: string;
  readonly reading: PocReading;
}

export type ReadingLookup = ReadonlyMap<string, PocReading>;

// ---------------------------------------------------------------- queries

export interface QueriesHeader {
  readonly schema: typeof QUERIES_SCHEMA;
  readonly rom: string;
  readonly sha1: string;
  readonly pocSourceDigest: string;
  readonly readings: string;
}

export interface SettledResult extends ReadingRef {
  readonly far: readonly number[];
  readonly noret: readonly number[];
}

export interface ClaimResult {
  readonly entry: number;
  readonly mode: Mode;
  /** The origin accept recorded for the entry, or null for an absorbed block. */
  readonly origin: string | null;
  /** True when f.entry is not an accepted function: absorbBlock claimed it into its owner. */
  readonly absorbed: boolean;
}

interface Shape<M extends PocMethod, A extends readonly unknown[], R> {
  readonly seq: number;
  readonly parent: number | null;
  readonly epoch: number;
  readonly method: M;
  readonly args: A;
  readonly result: R;
}

export type PocQuery =
  | Shape<'valid', readonly [entry: number], boolean>
  | Shape<'whyInvalid', readonly [entry: number], string | null>
  | Shape<'settle', readonly [entry: number], SettledResult>
  | Shape<'couldBeCode', readonly [target: number], boolean>
  | Shape<'acceptable', readonly [entry: number, why: string], boolean>
  | Shape<'inPointerTable', readonly [entry: number], boolean>
  | Shape<'thumbCandidate', readonly [entry: number, lo: number, hi: number], ReadingRef | null>
  | Shape<'armAhead', readonly [p: number, end: number], readonly [at: number, f: ReadingRef] | null>
  | Shape<'holeHead', readonly [entry: number, hi: number], ReadingRef | null>
  | Shape<'tryTiledHole', readonly [entry: number, hi: number], ReadingRef | null>
  | Shape<'absorbBlock', readonly [p: number, start: number, end: number], number | null>
  | Shape<'pointerCandidates', readonly [], { readonly pool: readonly number[]; readonly data: readonly number[] }>
  | Shape<'analyzeArm', readonly [entry: number], ReadingRef>
  | Shape<'forgetCandidates', readonly [], null>
  | Shape<'claim', readonly [entry: number], ClaimResult>;

// ---------------------------------------------------------------- field checks

function fail(where: string, message: string): never {
  throw new BenchError(`${where}: ${message}`);
}

function int(value: unknown, where: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 0xffff_ffff) fail(where, `expected an integer ≥ ${min}, got ${JSON.stringify(value)}`);
  return value;
}

/** A balance entry is a signed stack delta. */
function signed(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(where, `expected an integer, got ${JSON.stringify(value)}`);
  return value;
}

function array(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(where, 'expected an array');
  return value;
}

function tuple(value: unknown, length: number, where: string): readonly unknown[] {
  const items = array(value, where);
  if (items.length !== length) fail(where, `expected ${length} items, got ${items.length}`);
  return items;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where, 'expected an object');
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(where, 'expected a string');
  return value;
}

function bool(value: unknown, where: string): boolean {
  if (typeof value !== 'boolean') fail(where, 'expected true or false');
  return value;
}

function mode(value: unknown, where: string): Mode {
  if (value !== 'thumb' && value !== 'arm') fail(where, `expected thumb or arm, got ${JSON.stringify(value)}`);
  return value;
}

function ints(value: unknown, where: string): number[] {
  return array(value, where).map((v, i) => int(v, `${where}[${i}]`));
}

/** Ascending addresses without duplicates. */
function ascending(value: unknown, where: string): number[] {
  const out = ints(value, where);
  for (let i = 1; i < out.length; i++) if ((out[i] ?? 0) <= (out[i - 1] ?? 0)) fail(`${where}[${i}]`, 'not above the item before it (ascending, no duplicates)');
  return out;
}

function pairs(value: unknown, where: string): Array<readonly [number, number]> {
  return array(value, where).map((p, i) => {
    const [a, b] = tuple(p, 2, `${where}[${i}]`);
    return [int(a, `${where}[${i}][0]`), int(b, `${where}[${i}][1]`)] as const;
  });
}

function keyed<T extends readonly [number, ...unknown[]]>(items: readonly T[], where: string): readonly T[] {
  ascending(items.map((t) => t[0]), `${where} (first items)`);
  return items;
}

// ---------------------------------------------------------------- reading lines

const READING_KEYS = [
  'adrs', 'balance', 'blSites', 'calls', 'codeEnd', 'deadEnd', 'end', 'entry', 'errors', 'insnRuns', 'mode', 'pools',
  'returns', 'tables', 'tailExits', 'tails', 'veneers',
] as const;

/** Expands insnRuns into one [addr, len] per instruction, ascending. */
export function expandInsnRuns(value: unknown, where: string): Array<readonly [number, number]> {
  const insns: Array<readonly [number, number]> = [];
  array(value, where).forEach((run, i) => {
    const at = `${where}[${i}]`;
    const [start, len, n] = tuple(run, 3, at);
    const a = int(start, `${at}[0]`);
    const l = int(len, `${at}[1]`, 1);
    const k = int(n, `${at}[2]`, 1);
    const prev = insns[insns.length - 1];
    if (prev !== undefined && a <= prev[0]) fail(at, 'starts at or before the instruction before it (runs are ascending)');
    for (let j = 0; j < k; j++) insns.push([a + j * l, l]);
  });
  return insns;
}

/** Reads the `reading` member of a readings.ndjson line. */
export function parseReading(value: unknown, where: string): PocReading {
  const r = record(value, where);
  for (const key of Object.keys(r)) if (!(READING_KEYS as readonly string[]).includes(key)) fail(`${where}.${key}`, 'not a field of a reading');
  const tables = array(r['tables'], `${where}.tables`).map((t, i) => {
    const [base, targets] = tuple(t, 2, `${where}.tables[${i}]`);
    return [int(base, `${where}.tables[${i}][0]`), ints(targets, `${where}.tables[${i}][1]`)] as const;
  });
  return {
    entry: int(r['entry'], `${where}.entry`),
    mode: mode(r['mode'], `${where}.mode`),
    insns: expandInsnRuns(r['insnRuns'], `${where}.insnRuns`),
    pools: keyed(pairs(r['pools'], `${where}.pools`), `${where}.pools`),
    tables: keyed(tables, `${where}.tables`),
    calls: array(r['calls'], `${where}.calls`).map((c, i) => {
      const [target, m, site] = tuple(c, 3, `${where}.calls[${i}]`);
      return [int(target, `${where}.calls[${i}][0]`), mode(m, `${where}.calls[${i}][1]`), int(site, `${where}.calls[${i}][2]`)] as const;
    }),
    blSites: pairs(r['blSites'], `${where}.blSites`),
    deadEnd: ascending(r['deadEnd'], `${where}.deadEnd`),
    balance: array(r['balance'], `${where}.balance`).map((b, i) => signed(b, `${where}.balance[${i}]`)),
    returns: int(r['returns'], `${where}.returns`),
    errors: array(r['errors'], `${where}.errors`).map((e, i) => {
      const [reason, at] = tuple(e, 2, `${where}.errors[${i}]`);
      return [text(reason, `${where}.errors[${i}][0]`), int(at, `${where}.errors[${i}][1]`)] as const;
    }),
    veneers: ascending(r['veneers'], `${where}.veneers`),
    adrs: ascending(r['adrs'], `${where}.adrs`),
    tails: ascending(r['tails'], `${where}.tails`),
    tailExits: int(r['tailExits'], `${where}.tailExits`),
    codeEnd: int(r['codeEnd'], `${where}.codeEnd`),
    end: int(r['end'], `${where}.end`),
  };
}

/** The key of a stored reading: sha256 of its canonical JSON, as written (insnRuns, not insns). */
export function readingKey(stored: unknown): string {
  return sha256Stream(canonicalJson(stored as JsonValue));
}

const SHA256 = /^[0-9a-f]{64}$/;

export interface ReadingsOptions {
  /** Recomputes every key from its reading (default true). */
  readonly verifyKeys?: boolean;
}

/** Adds one readings.ndjson line to `into`; `where` names the file and line. */
export function addReadingLine(line: string, where: string, into: Map<string, PocReading>, options: ReadingsOptions = {}): void {
  const value = parseJsonLine(line, where);
  const v = record(value, where);
  const key = text(v['key'], `${where}.key`);
  if (!SHA256.test(key)) fail(`${where}.key`, 'expected a sha256 in lower-case hex');
  if (into.has(key)) fail(`${where}.key`, `the reading ${key} is listed twice`);
  const reading = parseReading(v['reading'], `${where}.reading`);
  if (options.verifyKeys !== false && readingKey(v['reading']) !== key) fail(`${where}.key`, 'is not the sha256 of the canonical JSON of its reading');
  into.set(key, reading);
}

/** Every reading of a readings.ndjson file, by key. */
export async function readReadings(path: string, options: ReadingsOptions = {}): Promise<Map<string, PocReading>> {
  const out = new Map<string, PocReading>();
  let n = 0;
  for await (const line of lines(path)) {
    n++;
    if (line === '') continue;
    addReadingLine(line, `${path}:${n}`, out, options);
  }
  return out;
}

// ---------------------------------------------------------------- query lines

function parseJsonLine(line: string, where: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    return fail(where, `not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Reads line 1 of queries.ndjson. */
export function parseQueriesHeader(value: unknown, where: string): QueriesHeader {
  const v = record(value, where);
  if (v['schema'] !== QUERIES_SCHEMA) fail(`${where}.schema`, `is ${JSON.stringify(v['schema'])}, expected ${QUERIES_SCHEMA}`);
  const readings = text(v['readings'], `${where}.readings`);
  if (readings.includes('/') || readings.includes('\\') || readings === '' || readings.startsWith('.')) fail(`${where}.readings`, 'expected a file name beside the log');
  return {
    schema: QUERIES_SCHEMA,
    rom: text(v['rom'], `${where}.rom`),
    sha1: text(v['sha1'], `${where}.sha1`),
    pocSourceDigest: text(v['pocSourceDigest'], `${where}.pocSourceDigest`),
    readings,
  };
}

function resolveReading(value: unknown, readings: ReadingLookup, where: string): ReadingRef {
  const v = record(value, where);
  const key = text(v['reading'], `${where}.reading`);
  const reading = readings.get(key);
  if (reading === undefined) fail(`${where}.reading`, `no reading has the key ${key}`);
  return { key, reading };
}

function args(value: unknown, spec: MethodSpec, where: string): unknown[] {
  const items = tuple(value, spec.args.length, where);
  return spec.args.map((unit, i) => (unit === 'text' ? text(items[i], `${where}[${i}]`) : int(items[i], `${where}[${i}]`)));
}

function result(shape: ResultShape, value: unknown, readings: ReadingLookup, where: string): unknown {
  switch (shape) {
    case 'boolean':
      return bool(value, where);
    case 'text-or-null':
      return value === null ? null : text(value, where);
    case 'settled': {
      const v = record(value, where);
      return { ...resolveReading(v, readings, where), far: ascending(v['far'], `${where}.far`), noret: ascending(v['noret'], `${where}.noret`) };
    }
    case 'reading':
      return resolveReading(value, readings, where);
    case 'reading-or-null':
      return value === null ? null : resolveReading(value, readings, where);
    case 'arm-ahead': {
      if (value === null) return null;
      const [at, f] = tuple(value, 2, where);
      return [int(at, `${where}[0]`), resolveReading(f, readings, `${where}[1]`)];
    }
    case 'offset-or-null':
      return value === null ? null : int(value, where);
    case 'candidates': {
      const v = record(value, where);
      return { pool: ascending(v['pool'], `${where}.pool`), data: ascending(v['data'], `${where}.data`) };
    }
    case 'null':
      if (value !== null) fail(where, 'expected null');
      return null;
    case 'claim': {
      const v = record(value, where);
      const origin = v['origin'];
      return {
        entry: int(v['entry'], `${where}.entry`),
        mode: mode(v['mode'], `${where}.mode`),
        origin: origin === null ? null : text(origin, `${where}.origin`),
        absorbed: bool(v['absorbed'], `${where}.absorbed`),
      };
    }
  }
}

/** What the reader knows between lines: the next seq, the epoch, and the calls the next one may nest in. */
export interface QueryLogState {
  nextSeq: number;
  epoch: number;
  /** The seqs of the previous record and its ancestors, outermost first. */
  readonly open: number[];
}

export function initialQueryLogState(): QueryLogState {
  return { nextSeq: 0, epoch: 0, open: [] };
}

/**
 * Reads one record line (after the header) and advances `state`: seq must be the next number, parent
 * null or the previous record or one of its ancestors, epoch the current one (one more for
 * forgetCandidates), the method recorded, args and result of its shape, every reading key known.
 */
export function parseQueryLine(line: string, where: string, state: QueryLogState, readings: ReadingLookup): PocQuery {
  const v = record(parseJsonLine(line, where), where);
  const method = text(v['method'], `${where}.method`);
  if (!isPocMethod(method)) fail(`${where}.method`, `${JSON.stringify(method)} is not a recorded method`);
  const seq = int(v['seq'], `${where}.seq`);
  if (seq !== state.nextSeq) fail(`${where}.seq`, `is ${seq}, expected ${state.nextSeq}`);
  const parent = v['parent'] === null ? null : int(v['parent'], `${where}.parent`);
  while (state.open.length > 0 && state.open[state.open.length - 1] !== parent) state.open.pop();
  if (parent !== null && state.open.length === 0) fail(`${where}.parent`, `${parent} is not a call that is still running at seq ${seq}`);
  const epoch = int(v['epoch'], `${where}.epoch`);
  const expected = method === 'forgetCandidates' ? state.epoch + 1 : state.epoch;
  if (epoch !== expected) fail(`${where}.epoch`, `is ${epoch}, expected ${expected}`);
  const spec: MethodSpec = POC_METHODS[method];
  // args and result were checked against POC_METHODS[method], whose shapes are those of PocQuery.
  const query = {
    seq,
    parent,
    epoch,
    method,
    args: args(v['args'], spec, `${where}.args`),
    result: result(spec.result, v['result'], readings, `${where}.result`),
  } as unknown as PocQuery;
  state.open.push(seq);
  state.nextSeq = seq + 1;
  state.epoch = epoch;
  return query;
}

// ---------------------------------------------------------------- the streaming reader

async function* lines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) yield line;
  } catch (error) {
    throw new BenchError(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stream.destroy();
  }
}

export interface PocLog {
  readonly header: QueriesHeader;
  readonly readings: ReadingLookup;
  /** The records in seq order, each validated and resolved as it is read; iterate once. */
  readonly queries: AsyncIterable<PocQuery>;
}

/**
 * Opens a queries.ndjson file: reads its header and the readings file it names (beside it), then
 * streams the records. A malformed record throws a BenchError naming `<path>:<line>` and the field.
 */
export async function openPocLog(path: string, options: ReadingsOptions = {}): Promise<PocLog> {
  let headerLine: string | undefined;
  for await (const line of lines(path)) {
    headerLine = line;
    break;
  }
  if (headerLine === undefined) throw new BenchError(`${path}: empty; expected the header on line 1`);
  const header = parseQueriesHeader(parseJsonLine(headerLine, `${path}:1`), `${path}:1`);
  const readings = await readReadings(join(dirname(path), header.readings), options);
  async function* queries(): AsyncGenerator<PocQuery> {
    const state = initialQueryLogState();
    let n = 0;
    for await (const line of lines(path)) {
      n++;
      if (n === 1) continue;
      if (line === '') fail(`${path}:${n}`, 'empty line');
      yield parseQueryLine(line, `${path}:${n}`, state, readings);
    }
  }
  return { header, readings, queries: queries() };
}
