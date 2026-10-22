// `npm run export-poc -- --mode scored|parity|queries|raw [--only <rom>]` (architecture §4.5, D11, D48,
// D50): runs the read-only PoC from ROMLIFT_POC with its own tsx (bench/tools/export-poc-child.ts),
// once per tuning dataset (never a sealed one), or once per committed fixture for `raw`, and writes what
// it found to the gitignored bench/.local/poc/<rom>/ (bench/.local/poc/raw/<fixture>/ for `raw`):
//
//   scored   scored.json, in the frozen ScoredRun shape (phase 1); a dump made on romlift's dataset (a ROM
//            the PoC has no dataset file of, D60) is checked against bench/baseline/poc-dump-rows.json,
//            which `--pin` writes instead (only from deterministic dumps). Every child runs first; the
//            dumps are written only once the rows are checked or pinned, so a failed check or a refused
//            pin leaves the previous dumps in place;
//   parity   parity.json, the parity view (bench/src/parity-view.ts), after two PoC processes have
//            produced the same digest; then bench/baseline/poc-digests.json, the digest per ROM;
//   queries  queries.ndjson and readings.ndjson, the lockstep log (bench/src/poc-log.ts), after
//            checking that the instrumented run's parity digest is the committed one, and re-reading
//            the whole log through the validating reader;
//   raw      per committed fixture (bench/dataset/synthetic/<name>/build/<name>.gba, `--only` names one):
//            the PoC's writeGenerated() tree in bench/.local/poc/raw/<fixture>/ and raw.json beside it,
//            per chunk of the PoC's tiling its span, name, kind, mode, module, labels and the body lines
//            its rawLines printed (cut out of the written file), with the PoC's claim kind of every byte;
//            test/local/poc-raw-printer.test.ts feeds romlift's printRawRange the same inputs (roadmap 3.B).
//
// It refuses a PoC checkout whose files differ from bench/baseline/poc-source.json and a ROM whose
// SHA-1 differs from its dataset.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareCodeUnits } from 'romlift';
import { sha1Of } from 'romlift/node';

import { listFixtures, type SyntheticFixture } from '../src/ablate.ts';
import { parseArgs, UsageError } from '../src/args.ts';
import { jsonDiffs, pocRomNames, readBaseline, stripSeconds } from '../src/baseline.ts';
import { contextFromEnv, scoredPath, type BenchContext } from '../src/context.ts';
import { loadDatasets, pocDatasets, tuningDatasets, type Dataset } from '../src/dataset.ts';
import { BenchError, exists, isRecord, prettyJson, readFileBytes, readJson, readText, writeText } from '../src/files.ts';
import {
  parityDigest,
  parityPath,
  parityText,
  parseParityView,
  parsePocDigests,
  pocDigestsPath,
  POC_DIGESTS_SCHEMA,
  type ParityView,
  type PocDigests,
} from '../src/parity-view.ts';
import { openPocLog, queriesPath } from '../src/poc-log.ts';
import { comparePocSource, computePocSource, readPinnedPocSource } from '../src/poc-source.ts';
import { runProcess } from '../src/process.ts';
import { analysisDigest, parseScoredRun, SCORED_SCHEMA, type ScoredRun } from '../src/scored-run.ts';
import {
  dumpRowMismatch,
  pocDatasetDigest,
  pocDatasetOf,
  pocDumpRowsPath,
  pocDumpRowsText,
  pocRowDigest,
  POC_DUMP_ROWS_SCHEMA,
  readPocDumpRows,
  type PinnedDumpRow,
} from '../src/poc-dump-rows.ts';

const USAGE = 'usage: npm run export-poc -- --mode scored|parity|queries|raw [--only <rom>] [--pin]';
const CHILD = fileURLToPath(new URL('./export-poc-child.ts', import.meta.url));

export const EXPORT_MODES = ['scored', 'parity', 'queries', 'raw'] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];

export function isExportMode(value: string | undefined): value is ExportMode {
  return (EXPORT_MODES as readonly (string | undefined)[]).includes(value);
}

// ---------------------------------------------------------------- pure post-processing

/** Builds the frozen scored.json value from the child's document; throws when the document is not as expected. */
export function scoredFromChild(doc: unknown, rom: string, sha1: string, pocSourceDigest: string, datasetDigest: string | null = null): ScoredRun {
  if (!isRecord(doc) || !Array.isArray(doc['analyses']) || doc['analyses'].length !== 2 || !isRecord(doc['row'])) {
    throw new BenchError(`${rom}: the PoC child printed no {analyses: [2], misses, row} document`);
  }
  const row = doc['row'];
  const scaffold = row['scaffold'];
  if (!isRecord(scaffold)) throw new BenchError(`${rom}: the PoC row has no scaffold verdict`);
  const [first, second] = doc['analyses'] as unknown[];
  const value = {
    schema: SCORED_SCHEMA,
    rom,
    sha1,
    pocSourceDigest,
    datasetDigest: doc['dataset'] === 'given' ? datasetDigest : null,
    analysis: first,
    misses: doc['misses'],
    digests: [analysisDigest(first), analysisDigest(second)],
    scaffold: { ok: scaffold['ok'], summary: scaffold['summary'] },
    pocRow: stripSeconds(row),
  };
  return parseScoredRun(value, `${rom}: the PoC child's document`);
}

/** One parity run of the child: the view it printed and how long the analysis took. */
export interface ParityRun {
  readonly view: ParityView;
  readonly seconds: number;
}

function seconds(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new BenchError(`${where}: expected a number of seconds`);
  return value;
}

/** Reads the child's `--mode parity` document, {parity, seconds}. */
export function parityFromChild(doc: unknown, rom: string): ParityRun {
  if (!isRecord(doc)) throw new BenchError(`${rom}: the PoC child printed no {parity, seconds} document`);
  return { view: parseParityView(doc['parity'], `${rom}: parity`), seconds: seconds(doc['seconds'], `${rom}: seconds`) };
}

/** The digest of a ROM's view when two PoC runs agree; a BenchError naming the first differences otherwise. */
export function deterministicDigest(rom: string, first: ParityView, second: ParityView): string {
  const a = parityDigest(first);
  const b = parityDigest(second);
  if (a !== b) {
    const diffs = jsonDiffs(first, second, '', 5).join('; ');
    throw new BenchError(`${rom}: the PoC is not deterministic: two runs have parity digests ${a} and ${b} (${diffs}); nothing written`);
  }
  return a;
}

/**
 * The poc-digests.json value: `digests` over the ROMs of `previous` when it pins the same PoC checkout
 * (an `--only` run keeps the other ROMs), keys sorted.
 */
export function pocDigestsDocument(pocSourceDigest: string, digests: Readonly<Record<string, string>>, previous?: PocDigests): PocDigests {
  const merged: Record<string, string> = previous?.pocSourceDigest === pocSourceDigest ? { ...previous.roms, ...digests } : { ...digests };
  const roms: Record<string, string> = {};
  for (const name of Object.keys(merged).sort(compareCodeUnits)) roms[name] = merged[name] ?? '';
  return parsePocDigests({ pocSourceDigest, roms, schema: POC_DIGESTS_SCHEMA }, 'poc-digests');
}

/** The committed spelling of poc-digests.json: two-space JSON, every key sorted. */
export function pocDigestsText(doc: PocDigests): string {
  return prettyJson({ pocSourceDigest: doc.pocSourceDigest, roms: doc.roms, schema: doc.schema });
}

/** What the child's `--mode queries` run printed. */
export interface QueriesRun extends ParityRun {
  readonly queries: number;
  readonly readings: number;
  readonly queryBytes: number;
  readonly readingBytes: number;
}

function count(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new BenchError(`${where}: expected a count`);
  return value;
}

export function queriesFromChild(doc: unknown, rom: string): QueriesRun {
  const run = parityFromChild(doc, rom);
  const d = doc as Record<string, unknown>;
  return {
    ...run,
    queries: count(d['queries'], `${rom}: queries`),
    readings: count(d['readings'], `${rom}: readings`),
    queryBytes: count(d['queryBytes'], `${rom}: queryBytes`),
    readingBytes: count(d['readingBytes'], `${rom}: readingBytes`),
  };
}

/** Refuses a queries run whose parity digest is not the committed one: the log would describe another run. */
export function checkCommittedDigest(rom: string, digest: string, committed: PocDigests, pocSourceDigest: string): void {
  if (committed.pocSourceDigest !== pocSourceDigest) {
    throw new BenchError(`${rom}: bench/baseline/poc-digests.json pins another PoC checkout; run --mode parity first`);
  }
  const want = committed.roms[rom];
  if (want === undefined) throw new BenchError(`${rom}: bench/baseline/poc-digests.json has no digest for it; run --mode parity first`);
  if (want !== digest) throw new BenchError(`${rom}: the instrumented run has parity digest ${digest}, the committed one is ${want}`);
}

// ---------------------------------------------------------------- the raw mode's dump

export const POC_RAW_SCHEMA = 'romlift-bench/poc-raw@1';

/** A label the PoC placed inside a chunk (an entry folded into another function's extent). */
export interface PocRawLabel {
  readonly addr: number;
  readonly name: string;
  readonly note?: string;
}

/** One chunk of the PoC's tile(), as the child printed it. */
export interface PocRawChunk {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly kind: 'func' | 'gap';
  readonly mode: 'thumb' | 'arm' | 'none';
  readonly module: string;
  readonly labels: readonly PocRawLabel[];
}

/** What the child's `raw` mode printed. */
export interface PocRawChild {
  readonly summary: string;
  readonly chunks: readonly PocRawChunk[];
  /** The PoC's claim kind per ROM byte: 0 free, 1 code, 2 pool, 3 table, 4 dead. */
  readonly claims: readonly number[];
}

/** raw.json: the child's chunks with the body lines rawLines printed for each. */
export interface PocRawDump {
  readonly schema: typeof POC_RAW_SCHEMA;
  readonly fixture: string;
  readonly sha1: string;
  readonly pocSourceDigest: string;
  readonly summary: string;
  readonly chunks: readonly (PocRawChunk & { readonly lines: readonly string[] })[];
  readonly claims: readonly number[];
}

const isAddr = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

function rawLabel(value: unknown, where: string): PocRawLabel {
  if (!isRecord(value) || !isAddr(value['addr']) || typeof value['name'] !== 'string') throw new BenchError(`${where}: not a {addr, name, note?} label`);
  const note = value['note'];
  if (note !== undefined && typeof note !== 'string') throw new BenchError(`${where}.note: not a string`);
  return note === undefined ? { addr: value['addr'], name: value['name'] } : { addr: value['addr'], name: value['name'], note };
}

function rawChunk(value: unknown, where: string): PocRawChunk {
  if (!isRecord(value)) throw new BenchError(`${where}: not an object`);
  const { start, end, name, kind, mode, module, labels } = value;
  if (!isAddr(start) || !isAddr(end) || end <= start) throw new BenchError(`${where}: start and end are not a non-empty span`);
  if (typeof name !== 'string' || name === '') throw new BenchError(`${where}.name: not a non-empty string`);
  if (kind !== 'func' && kind !== 'gap') throw new BenchError(`${where}.kind: not func or gap`);
  if (mode !== 'thumb' && mode !== 'arm' && mode !== 'none') throw new BenchError(`${where}.mode: not thumb, arm or none`);
  if (typeof module !== 'string' || module === '') throw new BenchError(`${where}.module: not a non-empty string`);
  if (!Array.isArray(labels)) throw new BenchError(`${where}.labels: not an array`);
  return { start, end, name, kind, mode, module, labels: labels.map((l: unknown, i) => rawLabel(l, `${where}.labels[${i}]`)) };
}

/** Reads the child's `--mode raw` document; throws a BenchError naming the first problem. */
export function rawFromChild(doc: unknown, fixture: string): PocRawChild {
  if (!isRecord(doc) || typeof doc['summary'] !== 'string' || !Array.isArray(doc['chunks']) || !Array.isArray(doc['claims'])) {
    throw new BenchError(`${fixture}: the PoC child printed no {summary, chunks, claims} document`);
  }
  const claims = doc['claims'] as unknown[];
  if (!claims.every((c) => c === 0 || c === 1 || c === 2 || c === 3 || c === 4)) throw new BenchError(`${fixture}: claims holds a value other than a claim kind 0..4`);
  const chunks = (doc['chunks'] as unknown[]).map((c, i) => rawChunk(c, `${fixture}: chunks[${i}]`));
  for (let i = 1; i < chunks.length; i++) {
    const [a, b] = [chunks[i - 1], chunks[i]];
    if (a !== undefined && b !== undefined && b.start < a.end) throw new BenchError(`${fixture}: chunks[${i}] starts inside chunks[${i - 1}]`);
  }
  return { summary: doc['summary'], chunks, claims: claims as number[] };
}

/** The file writeGenerated() writes a chunk to, relative to the tree: asm/crt0.s for the startup region. */
export function pocChunkFile(chunk: PocRawChunk): string {
  return chunk.module === 'crt0' ? 'asm/crt0.s' : `asm/nonmatchings/${chunk.module}/${chunk.name}.s`;
}

const hex8 = (v: number): string => v.toString(16).toUpperCase().padStart(8, '0');

/**
 * The lines rawLines printed for `chunk`, cut out of the text of its file: after the chunk's own label line
 * (`<name>: @ <ADDR>`), up to its `*_func_end` line (a function) or the next blank line or the end of the
 * file (a gap). rawLines never prints a blank line or a func_end, so the cut is exact.
 */
export function pocChunkLines(text: string, chunk: PocRawChunk): readonly string[] {
  const lines = text.split('\n');
  const head = `${chunk.name}: @ ${hex8(chunk.start)}`;
  const at = lines.findIndex((line) => line === head || line.startsWith(`${head}, `));
  if (at < 0) throw new BenchError(`${chunk.name}: no line ${JSON.stringify(head)} in ${pocChunkFile(chunk)}`);
  const end = `\t${chunk.mode === 'arm' ? 'arm_func_end' : 'thumb_func_end'} ${chunk.name}`;
  const body: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (chunk.kind === 'func' && line === end) return body;
    if (chunk.kind === 'gap' && line === '') return body;
    body.push(line);
  }
  if (chunk.kind === 'func') throw new BenchError(`${chunk.name}: no ${JSON.stringify(end.trim())} line after its label in ${pocChunkFile(chunk)}`);
  return body;
}

/** The raw.json value of one fixture: every chunk with its body lines, read through `readTree(path)`. */
export function pocRawDump(fixture: string, sha1: string, pocSourceDigest: string, child: PocRawChild, readTree: (path: string) => string): PocRawDump {
  return {
    schema: POC_RAW_SCHEMA,
    fixture,
    sha1,
    pocSourceDigest,
    summary: child.summary,
    chunks: child.chunks.map((c) => ({ ...c, lines: pocChunkLines(readTree(pocChunkFile(c)), c) })),
    claims: child.claims,
  };
}

/** bench/.local/poc/raw/<fixture>/, the PoC's tree and raw.json. */
export const pocRawDir = (cx: BenchContext, fixture: string): string => join(cx.repoRoot, 'bench', '.local', 'poc', 'raw', fixture);

// ---------------------------------------------------------------- running the child

async function checkedRom(cx: BenchContext, d: Dataset): Promise<string> {
  const bytes = await readFileBytes(join(cx.benchRoot, d.rom));
  const sha1 = sha1Of(bytes);
  if (sha1 !== d.sha1) throw new BenchError(`${d.name}: ${d.rom} has SHA-1 ${sha1}, the dataset records ${d.sha1}`);
  return sha1;
}

/** Runs the child for one dataset and returns the JSON document on its last stdout line. */
async function runChild(cx: BenchContext, d: Dataset, args: readonly string[]): Promise<unknown> {
  return runChildFor(cx, d.name, args, JSON.stringify(pocDatasetOf(d)));
}

/** Runs the child for `name` (a dataset, or a fixture with no dataset) and returns its last stdout line's JSON. */
async function runChildFor(cx: BenchContext, name: string, args: readonly string[], dataset: string | undefined): Promise<unknown> {
  const tsx = join(cx.pocRoot, 'node_modules', '.bin', 'tsx');
  if (!(await exists(tsx))) throw new BenchError(`${tsx} is missing: the PoC checkout has no node_modules`);
  // Run outside both repositories. The PoC scaffolds into os.tmpdir()/romlift-bench/<name>, so the child gets a
  // temporary directory of its own as TMPDIR (fix round 8, architecture-c0-5): two export-poc runs at once on one
  // machine no longer overwrite each other's scaffold and fail its verdict. Removed once the child exits.
  const cwd = await mkdtemp(join(tmpdir(), 'romlift-poc-'));
  try {
    return await runChildIn(cwd, tsx, name, args, cx, dataset);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

/** runChildFor's child, run in `cwd`, which is also its TMPDIR. */
async function runChildIn(cwd: string, tsx: string, name: string, args: readonly string[], cx: BenchContext, dataset: string | undefined): Promise<unknown> {
  const run = await runProcess(tsx, [CHILD, name, ...args], {
    cwd,
    env: {
      TMPDIR: cwd,
      ROMLIFT_BENCH_ROOT: cx.benchRoot,
      ROMLIFT_POC: cx.pocRoot,
      // For a tuning ROM the pinned PoC has no dataset file of (tmc, D60): the child uses the PoC's own file when it has one.
      ROMLIFT_POC_DATASET: dataset,
      ROMLIFT_TABLES: undefined,
      ROMLIFT_ARMSCAN: undefined,
      ROMLIFT_TRACE: undefined,
    },
    echoStderr: true,
  });
  if (run.code !== 0) throw new BenchError(`${name}: the PoC child exited ${run.code}`);
  const last = run.stdout.split('\n').filter((line) => line.trim() !== '').pop();
  if (last === undefined) throw new BenchError(`${name}: the PoC child printed nothing`);
  try {
    return JSON.parse(last) as unknown;
  } catch {
    throw new BenchError(`${name}: the PoC child's last line is not JSON`);
  }
}

/** Runs the PoC's scored run of `d`; nothing is written yet (writeScored, after the rows are checked or pinned). */
async function exportScored(cx: BenchContext, d: Dataset, pocSourceDigest: string): Promise<ScoredRun> {
  const sha1 = await checkedRom(cx, d);
  const scored = scoredFromChild(await runChild(cx, d, ['scored']), d.name, sha1, pocSourceDigest, pocDatasetDigest(d));
  const same = scored.digests[0] === scored.digests[1];
  process.stdout.write(
    `${d.name.padEnd(12)} ${scored.analysis.functions.length} functions, ${scored.misses.length} misses, ` +
      `scaffold ${scored.scaffold.ok ? 'OK' : 'FAILED'}, ${same ? 'deterministic' : 'NOT DETERMINISTIC'}` +
      `${scored.datasetDigest === null ? '' : `, on romlift's dataset ${scored.datasetDigest.slice(0, 12)}…`}\n`,
  );
  return scored;
}

/** Writes the dump of one scored run to bench/.local/poc/<rom>/scored.json. */
async function writeScored(cx: BenchContext, d: Dataset, scored: ScoredRun): Promise<void> {
  await writeText(scoredPath(cx, d.name), `${JSON.stringify(scored)}\n`);
  process.stdout.write(`${d.name.padEnd(12)} -> ${scoredPath(cx, d.name)}\n`);
}

/**
 * The pinned PoC rows after a scored export: each dump made on romlift's dataset is checked against
 * bench/baseline/poc-dump-rows.json, or, with `pin`, written into it (the diff in Git is the review).
 */
async function checkOrPinDumpRows(cx: BenchContext, runs: readonly { readonly d: Dataset; readonly scored: ScoredRun }[], pocSourceDigest: string, pin: boolean): Promise<void> {
  const committed = await readPocDumpRows(cx);
  const roms: Record<string, PinnedDumpRow> = { ...(committed?.pocSourceDigest === pocSourceDigest ? committed.roms : {}) };
  const problems: string[] = [];
  for (const { d, scored } of runs) {
    if (scored.datasetDigest === null) continue;
    if (pin) {
      // A row is pinned only from a dump whose two PoC runs agree: a non-deterministic row is no reference.
      if (scored.digests[0] !== scored.digests[1]) {
        problems.push(`${d.name}: not pinned, the PoC's two runs disagree`);
        continue;
      }
      const tp = scored.pocRow['tp'];
      roms[d.name] = { datasetDigest: scored.datasetDigest, rowDigest: pocRowDigest(scored.pocRow), tp: typeof tp === 'number' ? tp : 0 };
      continue;
    }
    const why = dumpRowMismatch(d, committed, scored.pocSourceDigest, scored.datasetDigest, scored.pocRow);
    if (why !== undefined) problems.push(why);
    else process.stdout.write(`${d.name.padEnd(12)} the PoC's row equals the one pinned in ${pocDumpRowsPath(cx)}\n`);
  }
  if (problems.length > 0) {
    throw new BenchError(
      pin ? `refusing to pin, nothing written:\n${problems.join('\n')}` : `the PoC's rows differ from the pinned ones, no dump written (re-pin with --pin only after reviewing why):\n${problems.join('\n')}`,
    );
  }
  if (pin) {
    await writeText(pocDumpRowsPath(cx), pocDumpRowsText({ schema: POC_DUMP_ROWS_SCHEMA, pocSourceDigest, roms }));
    process.stdout.write(`${Object.keys(roms).length} pinned PoC rows -> ${pocDumpRowsPath(cx)}\n`);
  }
}

/** Two PoC processes per ROM; parity.json is written only when their digests agree. Returns the digest. */
async function exportParity(cx: BenchContext, d: Dataset): Promise<string> {
  await checkedRom(cx, d);
  const first = parityFromChild(await runChild(cx, d, ['parity']), d.name);
  const second = parityFromChild(await runChild(cx, d, ['parity']), d.name);
  const digest = deterministicDigest(d.name, first.view, second.view);
  await writeText(parityPath(cx, d.name), parityText(first.view));
  process.stdout.write(
    `${d.name.padEnd(12)} ${first.view.functions.length} functions, ${first.view.claims.length} claim runs, ` +
      `analysis ${first.seconds.toFixed(1)} s / ${second.seconds.toFixed(1)} s, deterministic, parity ${digest} -> ${parityPath(cx, d.name)}\n`,
  );
  return digest;
}

const mib = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MiB`;

async function exportQueries(cx: BenchContext, d: Dataset, pocSourceDigest: string, committed: PocDigests): Promise<void> {
  const sha1 = await checkedRom(cx, d);
  const path = queriesPath(cx, d.name);
  const run = queriesFromChild(await runChild(cx, d, ['queries', dirname(path), sha1, pocSourceDigest]), d.name);
  checkCommittedDigest(d.name, parityDigest(run.view), committed, pocSourceDigest);
  // Re-read the whole log through the validating reader: the archived log is well formed.
  const started = process.hrtime.bigint();
  const log = await openPocLog(path);
  let records = 0;
  for await (const query of log.queries) records = query.seq + 1;
  const readSeconds = Number(process.hrtime.bigint() - started) / 1e9;
  if (log.header.rom !== d.name || log.header.sha1 !== sha1 || log.header.pocSourceDigest !== pocSourceDigest) {
    throw new BenchError(`${path}: its header names another ROM or PoC checkout`);
  }
  if (records !== run.queries || log.readings.size !== run.readings) {
    throw new BenchError(`${path}: holds ${records} queries and ${log.readings.size} readings, the child wrote ${run.queries} and ${run.readings}`);
  }
  process.stdout.write(
    `${d.name.padEnd(12)} ${run.view.functions.length} functions, ${run.queries} queries (${mib(run.queryBytes)}), ` +
      `${run.readings} readings (${mib(run.readingBytes)}), run ${run.seconds.toFixed(1)} s, re-read ${readSeconds.toFixed(1)} s, ` +
      `parity matches the committed digest -> ${path}\n`,
  );
}

/** The PoC's raw tree of one fixture and its raw.json. */
async function exportRaw(cx: BenchContext, f: SyntheticFixture, pocSourceDigest: string): Promise<void> {
  const sha1 = sha1Of(await readFileBytes(f.rom));
  const dir = pocRawDir(cx, f.name);
  await rm(dir, { recursive: true, force: true });
  const child = rawFromChild(await runChildFor(cx, f.name, ['raw', f.rom, dir], undefined), f.name);
  const files = new Map<string, string>();
  for (const c of child.chunks) {
    const file = pocChunkFile(c);
    if (!files.has(file)) files.set(file, await readText(join(dir, file)));
  }
  const dump = pocRawDump(f.name, sha1, pocSourceDigest, child, (file) => files.get(file) ?? '');
  await writeText(join(dir, 'raw.json'), `${JSON.stringify(dump)}\n`);
  const lines = dump.chunks.reduce((n, c) => n + c.lines.length, 0);
  process.stdout.write(`${f.name.padEnd(32)} ${dump.chunks.length} chunks, ${lines} body lines -> ${join(dir, 'raw.json')}\n`);
}

async function readCommittedDigests(cx: BenchContext): Promise<PocDigests | undefined> {
  const path = pocDigestsPath(cx);
  if (!(await exists(path))) return undefined;
  return parsePocDigests(await readJson(path), path);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['mode', 'only'], flags: ['pin'] });
  const mode = args.options['mode'];
  if (!isExportMode(mode)) throw new UsageError(`--mode must be scored, parity, queries or raw\n${USAGE}`);
  const cx = contextFromEnv(process.env);
  const pinned = await readPinnedPocSource(cx);
  const actual = await computePocSource(cx.pocRoot);
  const problems = comparePocSource(pinned, actual);
  if (problems.length > 0) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    throw new BenchError(`refusing to run: the PoC checkout at ${cx.pocRoot} is not the pinned one (bench/baseline/poc-source.json)`);
  }
  const only = args.options['only'];
  if (mode === 'raw') {
    if (args.flags.has('pin')) throw new UsageError(`--pin goes with --mode scored\n${USAGE}`);
    const fixtures = (await listFixtures(cx)).filter((f) => only === undefined || f.name === only);
    if (fixtures.length === 0) throw new BenchError(only === undefined ? 'no committed fixture under bench/dataset/synthetic' : `no committed fixture named ${only}`);
    for (const f of fixtures) await exportRaw(cx, f, pinned.digest);
    process.stdout.write(`${fixtures.length} fixture(s) -> ${join(cx.repoRoot, 'bench', '.local', 'poc', 'raw')}\n`);
    return 0;
  }
  const { datasets, problems: datasetProblems } = await loadDatasets(cx);
  if (datasetProblems.length > 0) throw new BenchError(`malformed datasets: ${datasetProblems.map((p) => p.detail).join('; ')}`);
  // scored: every tuning dataset (the PoC's scaffold measures the scaffold family until phase 3, and its
  // own row is the PoC reference of a ROM its baseline does not name, D60); parity and queries: the ROMs
  // of the PoC baseline, whose digests and logs are committed evidence.
  const chosen = mode === 'scored' ? tuningDatasets(datasets, only) : pocDatasets(datasets, pocRomNames(await readBaseline(cx)), only);
  if (chosen.length === 0) throw new BenchError(only === undefined ? 'no tuning datasets the PoC ran on' : `no tuning dataset named ${only} that the PoC ran on`);
  if (mode === 'scored') {
    const runs: { readonly d: Dataset; readonly scored: ScoredRun }[] = [];
    for (const d of chosen) runs.push({ d, scored: await exportScored(cx, d, pinned.digest) });
    await checkOrPinDumpRows(cx, runs, pinned.digest, args.flags.has('pin'));
    for (const { d, scored } of runs) await writeScored(cx, d, scored);
  } else if (mode === 'parity') {
    const digests: Record<string, string> = {};
    for (const d of chosen) digests[d.name] = await exportParity(cx, d);
    const doc = pocDigestsDocument(pinned.digest, digests, await readCommittedDigests(cx));
    await writeText(pocDigestsPath(cx), pocDigestsText(doc));
    process.stdout.write(`${Object.keys(doc.roms).length} parity digests -> ${pocDigestsPath(cx)}\n`);
  } else {
    const committed = await readCommittedDigests(cx);
    if (committed === undefined) throw new BenchError(`${pocDigestsPath(cx)} is missing; run --mode parity first`);
    for (const d of chosen) await exportQueries(cx, d, pinned.digest, committed);
  }
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(error instanceof UsageError ? 2 : 1);
    },
  );
}
