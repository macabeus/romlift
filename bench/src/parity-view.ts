// The parity view (architecture §4.5, D11, D50): the fields of one analysis that both the PoC and
// romlift produce, as canonical JSON with addresses as numbers. export-poc writes the PoC's view to
// the gitignored bench/.local/poc/<rom>/parity.json and commits its digest per ROM in
// bench/baseline/poc-digests.json; bench/src/parity.ts builds the same view from romlift's
// AnalysisResult. This module freezes the shape, reads it field by field, and digests it.
//
// Every address is a GBA bus address (0x08000000 is the first ROM byte). Arrays are sorted ascending
// and runs are maximal, so one analysis has exactly one view:
//
//   functions  one per accepted function, by entry:
//     entry, mode, end (the PoC's Func.end: code plus the pools and tables that follow it),
//     codeEnd (the end of its last instruction), code (maximal [start, end) runs of instruction
//     bytes, absorbed blocks included), pools (every literal-pool word it loads), tables
//     ([base, count] of each jump table), far (its bl sites settled as jumps; [] for ARM),
//     noreturn (its bl sites settled as calls that never return; [] for ARM), origin (the PoC's
//     origin text with spaces as '-', e.g. 'gap-scan');
//   claims     maximal [start, end, kind] runs of one nonzero claim kind, in ROM order;
//   startup    the startup region: its end and the entries inside it;
//   codeEnd    the end of the highest function extent (the PoC's codeRange[1]).
import { join } from 'node:path';

import { canonicalJson, compareCodeUnits, type JsonValue, type Mode } from 'romlift';
import { sha256Stream } from 'romlift/node';

import { baselineDir, type BenchContext } from './context.ts';
import { BenchError, isRecord } from './files.ts';

export const PARITY_SCHEMA = 'romlift-bench/parity@1';
export const POC_DIGESTS_SCHEMA = 'romlift-bench/poc-digests@1';

/** The claim kinds of the PoC's `claimed[]`: code, literal pool, jump table, dead bytes inside a function. */
export const CLAIM_KIND = { code: 1, pool: 2, table: 3, dead: 4 } as const;
export type ClaimKindCode = (typeof CLAIM_KIND)[keyof typeof CLAIM_KIND];

export type AddrSpan = readonly [start: number, end: number];

export interface ParityFunction {
  readonly entry: number;
  readonly mode: Mode;
  readonly end: number;
  readonly codeEnd: number;
  readonly code: readonly AddrSpan[];
  readonly pools: readonly number[];
  readonly tables: ReadonlyArray<readonly [base: number, count: number]>;
  readonly far: readonly number[];
  readonly noreturn: readonly number[];
  readonly origin: string;
}

export interface ParityView {
  readonly schema: typeof PARITY_SCHEMA;
  readonly functions: readonly ParityFunction[];
  readonly claims: ReadonlyArray<readonly [start: number, end: number, kind: ClaimKindCode]>;
  readonly startup: { readonly end: number; readonly entries: readonly number[] };
  readonly codeEnd: number;
}

/** bench/baseline/poc-digests.json: the parity digest of each tuning ROM, for one pinned PoC checkout. */
export interface PocDigests {
  readonly schema: typeof POC_DIGESTS_SCHEMA;
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, string>>;
}

/** The parity digest: sha256 of the view's canonical JSON, so key order never matters. */
export function parityDigest(view: ParityView): string {
  return sha256Stream(canonicalJson(view as unknown as JsonValue));
}

/** The view as written to parity.json: its canonical JSON and a final newline. */
export function parityText(view: ParityView): string {
  return `${Array.from(canonicalJson(view as unknown as JsonValue)).join('')}\n`;
}

export const parityPath = (cx: BenchContext, rom: string): string => join(cx.repoRoot, 'bench', '.local', 'poc', rom, 'parity.json');
export const pocDigestsPath = (cx: BenchContext): string => join(baselineDir(cx), 'poc-digests.json');

// ---------------------------------------------------------------- reading

function addr(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new BenchError(`${where}: expected an address (an integer in 0..0xFFFFFFFF), got ${JSON.stringify(value)}`);
  }
  return value;
}

function count(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new BenchError(`${where}: expected a positive integer, got ${JSON.stringify(value)}`);
  return value;
}

function array(value: unknown, where: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new BenchError(`${where}: expected an array`);
  return value;
}

function tuple(value: unknown, length: number, where: string): readonly unknown[] {
  const items = array(value, where);
  if (items.length !== length) throw new BenchError(`${where}: expected ${length} items, got ${items.length}`);
  return items;
}

/** Ascending addresses, each greater than the one before. */
function addresses(value: unknown, where: string): number[] {
  const out = array(value, where).map((a, i) => addr(a, `${where}[${i}]`));
  for (let i = 1; i < out.length; i++) {
    if ((out[i] ?? 0) <= (out[i - 1] ?? 0)) throw new BenchError(`${where}[${i}]: not above the address before it (sorted, no duplicates)`);
  }
  return out;
}

/** Maximal ascending [start, end) spans: each nonempty and starting after the end of the one before. */
function spans(value: unknown, where: string): AddrSpan[] {
  const out = array(value, where).map((s, i): AddrSpan => {
    const at = `${where}[${i}]`;
    const [start, end] = tuple(s, 2, at);
    const span: AddrSpan = [addr(start, `${at}[0]`), addr(end, `${at}[1]`)];
    if (span[1] <= span[0]) throw new BenchError(`${at}: empty or reversed span`);
    return span;
  });
  for (let i = 1; i < out.length; i++) {
    if ((out[i]?.[0] ?? 0) <= (out[i - 1]?.[1] ?? 0)) throw new BenchError(`${where}[${i}]: overlaps or touches the run before it (runs are maximal)`);
  }
  return out;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new BenchError(`${where}: expected a string`);
  return value;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new BenchError(`${where}: expected an object`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new BenchError(`${where}.${key}: not a field of the parity view`);
}

const FUNCTION_KEYS = ['entry', 'mode', 'end', 'codeEnd', 'code', 'pools', 'tables', 'far', 'noreturn', 'origin'] as const;

function parityFunction(value: unknown, where: string): ParityFunction {
  const f = record(value, where);
  onlyKeys(f, FUNCTION_KEYS, where);
  const mode = f['mode'];
  if (mode !== 'thumb' && mode !== 'arm') throw new BenchError(`${where}.mode: expected thumb or arm, got ${JSON.stringify(mode)}`);
  const tables = array(f['tables'], `${where}.tables`).map((t, i): readonly [number, number] => {
    const [base, n] = tuple(t, 2, `${where}.tables[${i}]`);
    return [addr(base, `${where}.tables[${i}][0]`), count(n, `${where}.tables[${i}][1]`)];
  });
  addresses(tables.map(([base]) => base), `${where}.tables (bases)`);
  const origin = text(f['origin'], `${where}.origin`);
  if (origin === '' || origin.includes(' ')) throw new BenchError(`${where}.origin: expected a nonempty text with '-' for spaces, got ${JSON.stringify(origin)}`);
  const out: ParityFunction = {
    entry: addr(f['entry'], `${where}.entry`),
    mode,
    end: addr(f['end'], `${where}.end`),
    codeEnd: addr(f['codeEnd'], `${where}.codeEnd`),
    code: spans(f['code'], `${where}.code`),
    pools: addresses(f['pools'], `${where}.pools`),
    tables,
    far: addresses(f['far'], `${where}.far`),
    noreturn: addresses(f['noreturn'], `${where}.noreturn`),
    origin,
  };
  if (out.mode === 'arm' && (out.far.length > 0 || out.noreturn.length > 0)) throw new BenchError(`${where}: an ARM function has no far or noreturn sites`);
  return out;
}

/** Reads a parity.json value; throws a BenchError naming the first field that is not as frozen. */
export function parseParityView(value: unknown, where: string): ParityView {
  const v = record(value, where);
  onlyKeys(v, ['schema', 'functions', 'claims', 'startup', 'codeEnd'], where);
  if (v['schema'] !== PARITY_SCHEMA) throw new BenchError(`${where}.schema: is ${JSON.stringify(v['schema'])}, expected ${PARITY_SCHEMA}`);
  const functions = array(v['functions'], `${where}.functions`).map((f, i) => parityFunction(f, `${where}.functions[${i}]`));
  addresses(functions.map((f) => f.entry), `${where}.functions (entries)`);
  const claims = array(v['claims'], `${where}.claims`).map((c, i): readonly [number, number, ClaimKindCode] => {
    const at = `${where}.claims[${i}]`;
    const [start, end, kind] = tuple(c, 3, at);
    if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4) throw new BenchError(`${at}[2]: expected a claim kind 1 to 4, got ${JSON.stringify(kind)}`);
    const run: readonly [number, number, ClaimKindCode] = [addr(start, `${at}[0]`), addr(end, `${at}[1]`), kind];
    if (run[1] <= run[0]) throw new BenchError(`${at}: empty or reversed run`);
    return run;
  });
  for (let i = 1; i < claims.length; i++) {
    const [prev, run] = [claims[i - 1], claims[i]];
    if (prev === undefined || run === undefined) continue;
    if (run[0] < prev[1]) throw new BenchError(`${where}.claims[${i}]: overlaps or precedes the run before it`);
    if (run[0] === prev[1] && run[2] === prev[2]) throw new BenchError(`${where}.claims[${i}]: continues the run before it with the same kind (runs are maximal)`);
  }
  const startup = record(v['startup'], `${where}.startup`);
  onlyKeys(startup, ['end', 'entries'], `${where}.startup`);
  return {
    schema: PARITY_SCHEMA,
    functions,
    claims,
    startup: { end: addr(startup['end'], `${where}.startup.end`), entries: addresses(startup['entries'], `${where}.startup.entries`) },
    codeEnd: addr(v['codeEnd'], `${where}.codeEnd`),
  };
}

const SHA256 = /^[0-9a-f]{64}$/;

/** Reads a poc-digests.json value; throws a BenchError naming the first field that is not as frozen. */
export function parsePocDigests(value: unknown, where: string): PocDigests {
  const v = record(value, where);
  onlyKeys(v, ['schema', 'pocSourceDigest', 'roms'], where);
  if (v['schema'] !== POC_DIGESTS_SCHEMA) throw new BenchError(`${where}.schema: is ${JSON.stringify(v['schema'])}, expected ${POC_DIGESTS_SCHEMA}`);
  const source = text(v['pocSourceDigest'], `${where}.pocSourceDigest`);
  if (!SHA256.test(source)) throw new BenchError(`${where}.pocSourceDigest: expected a sha256 in lower-case hex`);
  const roms = record(v['roms'], `${where}.roms`);
  const out: Record<string, string> = {};
  for (const name of Object.keys(roms).sort(compareCodeUnits)) {
    const digest = text(roms[name], `${where}.roms.${name}`);
    if (!SHA256.test(digest)) throw new BenchError(`${where}.roms.${name}: expected a sha256 in lower-case hex`);
    out[name] = digest;
  }
  return { schema: POC_DIGESTS_SCHEMA, pocSourceDigest: source, roms: out };
}
