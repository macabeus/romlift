// The PoC dump of one ROM, bench/.local/poc/<rom>/scored.json (architecture §4.5), written by
// export-poc in a frozen shape, and its reader. The dump keeps the PoC's own texts (origins such as
// 'gap scan', miss diagnoses such as 'inside code of the accepted function at …'); this reader is
// the only place that maps them to the vocabulary ids, with the PoC's own prefix rules.
import { isOrigin, parseHexAddr, type MissReason, type Mode, type Origin } from 'romlift';

import { BenchError, isRecord } from './files.ts';

export const SCORED_SCHEMA = 'romlift-bench/poc-scored@1';

export interface DumpFunction {
  readonly entry: string;
  readonly mode: Mode;
  readonly end: string;
  /** The PoC's origin text. */
  readonly origin: string;
}

/** What one PoC analysis found: the part whose digest proves determinism. */
export interface DumpAnalysis {
  readonly functions: readonly DumpFunction[];
  readonly startup: { readonly end: string; readonly entries: readonly string[] };
  readonly codeRange: readonly [string, string];
}

export interface DumpMiss {
  readonly addr: string;
  /** The PoC's diagnoseMiss text. */
  readonly reason: string;
}

/** The bench's ScoredRun: one PoC run of one ROM, as export-poc writes it. */
export interface ScoredRun {
  readonly schema: typeof SCORED_SCHEMA;
  readonly rom: string;
  readonly sha1: string;
  readonly pocSourceDigest: string;
  readonly analysis: DumpAnalysis;
  readonly misses: readonly DumpMiss[];
  /** sha256 of the canonical JSON of each of the two analyses. */
  readonly digests: readonly [string, string];
  readonly scaffold: { readonly ok: boolean; readonly summary: string };
  /** The PoC's own runRom row, minus its seconds. */
  readonly pocRow: Readonly<Record<string, unknown>>;
}

/** The PoC's diagnoseMiss text to its reason id (the PoC's missReasonId, verbatim in effect). */
export function missReasonId(text: string): MissReason {
  if (text.startsWith('inside ')) return 'inside-code';
  if (text.startsWith('ARM routine')) return 'arm-unreached';
  if (text.includes('not dense')) return 'not-dense';
  if (text.includes('pops more')) return 'pops-frame';
  if (text.includes('no return and no push')) return 'no-return-no-prologue';
  if (text.includes('claimed')) return 'pool-claimed';
  if (text.includes('Thumb code pointers')) return 'pointer-table';
  if (text.includes('calls ')) return 'calls-non-code';
  if (text.includes('valid but not accepted')) return 'unanchored';
  return 'decode-error';
}

/** The PoC's origin text ('gap scan') to its origin id ('gap-scan'); undefined when it names none. */
export function originId(text: string): Origin | undefined {
  const id = text.replace(/ /g, '-');
  return isOrigin(id) ? id : undefined;
}

const ADDR = /^0x[0-9A-F]{8}$/;

function addr(value: unknown, where: string): string {
  if (typeof value !== 'string' || !ADDR.test(value)) throw new BenchError(`${where}: expected 0x and eight upper-case hex digits, got ${String(value)}`);
  return value;
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new BenchError(`${where}: expected a string`);
  return value;
}

/** Reads a scored.json value; throws a BenchError naming the first field that is not as frozen. */
export function parseScoredRun(value: unknown, where: string): ScoredRun {
  if (!isRecord(value)) throw new BenchError(`${where}: not a JSON object`);
  if (value['schema'] !== SCORED_SCHEMA) throw new BenchError(`${where}: schema is ${String(value['schema'])}, expected ${SCORED_SCHEMA}`);
  const analysis = value['analysis'];
  if (!isRecord(analysis) || !Array.isArray(analysis['functions']) || !isRecord(analysis['startup']) || !Array.isArray(analysis['codeRange'])) {
    throw new BenchError(`${where}: analysis must hold functions, startup and codeRange`);
  }
  const functions: DumpFunction[] = analysis['functions'].map((f: unknown, i: number) => {
    const at = `${where}: analysis.functions[${i}]`;
    if (!isRecord(f)) throw new BenchError(`${at}: not an object`);
    const mode = f['mode'];
    if (mode !== 'thumb' && mode !== 'arm') throw new BenchError(`${at}: mode must be thumb or arm`);
    return { entry: addr(f['entry'], `${at}.entry`), mode, end: addr(f['end'], `${at}.end`), origin: str(f['origin'], `${at}.origin`) };
  });
  const startup = analysis['startup'];
  if (!Array.isArray(startup['entries'])) throw new BenchError(`${where}: analysis.startup.entries must be an array`);
  const range = analysis['codeRange'];
  if (range.length !== 2) throw new BenchError(`${where}: analysis.codeRange must hold two addresses`);
  const misses = value['misses'];
  if (!Array.isArray(misses)) throw new BenchError(`${where}: misses must be an array`);
  const digests = value['digests'];
  if (!Array.isArray(digests) || digests.length !== 2) throw new BenchError(`${where}: digests must hold two digests`);
  const scaffold = value['scaffold'];
  if (!isRecord(scaffold) || typeof scaffold['ok'] !== 'boolean') throw new BenchError(`${where}: scaffold.ok must be a boolean`);
  const pocRow = value['pocRow'];
  if (!isRecord(pocRow)) throw new BenchError(`${where}: pocRow must be an object`);
  return {
    schema: SCORED_SCHEMA,
    rom: str(value['rom'], `${where}: rom`),
    sha1: str(value['sha1'], `${where}: sha1`),
    pocSourceDigest: str(value['pocSourceDigest'], `${where}: pocSourceDigest`),
    analysis: {
      functions,
      startup: {
        end: addr(startup['end'], `${where}: analysis.startup.end`),
        entries: startup['entries'].map((e: unknown, i: number) => addr(e, `${where}: analysis.startup.entries[${i}]`)),
      },
      codeRange: [addr(range[0], `${where}: analysis.codeRange[0]`), addr(range[1], `${where}: analysis.codeRange[1]`)],
    },
    misses: misses.map((m: unknown, i: number) => {
      if (!isRecord(m)) throw new BenchError(`${where}: misses[${i}] is not an object`);
      return { addr: addr(m['addr'], `${where}: misses[${i}].addr`), reason: str(m['reason'], `${where}: misses[${i}].reason`) };
    }),
    digests: [str(digests[0], `${where}: digests[0]`), str(digests[1], `${where}: digests[1]`)],
    scaffold: { ok: scaffold['ok'], summary: str(scaffold['summary'], `${where}: scaffold.summary`) },
    pocRow,
  };
}

/** A dump address as a number (the reader has checked its spelling). */
export function dumpAddr(text: string): number {
  const value = parseHexAddr(text);
  if (value === undefined) throw new BenchError(`not an address: ${text}`);
  return value;
}
