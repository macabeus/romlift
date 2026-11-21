// Runs inside the PoC's own tsx (spawned by export-poc.ts) for one dataset or fixture, in one of four modes
// (architecture §4.5):
//
//   scored   prints one JSON document: two analyses of the ROM by the PoC's Analyzer, the PoC's miss
//            diagnoses against its own ELF truth, and the PoC's own bench row with its scaffold built
//            (scaffold, make, generate, make, in os.tmpdir()/romlift-bench/<name>, where os.tmpdir() is a fresh directory
//            export-poc gives each child as TMPDIR, fix round 8);
//   parity   prints one JSON document {parity, seconds}: the parity view of one analysis
//            (bench/src/parity-view.ts);
//   queries  writes the lockstep log (bench/src/poc-log.ts) to <out>/queries.ndjson and
//            <out>/readings.ndjson, and prints {parity, queries, readings, queryBytes, readingBytes,
//            seconds} for the same run, so the parent can check that the instrumented run is the run
//            the committed parity digest describes;
//   raw      for one committed fixture ROM: the PoC's analysis and its writeGenerated() into <out> (the
//            raw tree, every chunk's bytes as data), and one JSON document {summary, chunks, claims}: per
//            chunk of the PoC's tile() its span, name, kind, mode, module and labels, and the PoC's claim
//            kind of every ROM byte (0 free, 1 code, 2 pool, 3 table, 4 dead), so the parent can cut the
//            chunks' body lines out of the written files and romlift's raw printer can be fed the same
//            spans, labels and word kinds (roadmap 3.B).
//
// It imports only node:* and the PoC's modules, by non-literal dynamic import from ROMLIFT_POC, typed
// through the local interfaces below. It never writes inside the PoC checkout and never edits a PoC
// file: the parity and queries modes wrap methods of the Analyzer prototype at run time. The PoC's
// experiment switches (ROMLIFT_TABLES, ROMLIFT_ARMSCAN, ROMLIFT_TRACE) are removed before anything is
// imported, so every mode runs the PoC's defaults.
//
// Usage: tsx export-poc-child.ts <dataset> scored|parity
//        tsx export-poc-child.ts <dataset> queries <out dir> <rom sha1> <poc source digest>
//        tsx export-poc-child.ts <fixture> raw <rom path> <out dir>
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const name of ['ROMLIFT_TABLES', 'ROMLIFT_ARMSCAN', 'ROMLIFT_TRACE']) delete process.env[name];

type Mode = 'thumb' | 'arm';

interface PocCall {
  readonly target: number;
  readonly mode: Mode;
  readonly site: number;
}

interface PocFunc {
  readonly entry: number;
  readonly mode: Mode;
  readonly insns: ReadonlyMap<number, number>;
  readonly pools: ReadonlyMap<number, number>;
  readonly tables: ReadonlyMap<number, readonly number[]>;
  readonly blSites: ReadonlyArray<readonly [number, number]>;
  readonly deadEnd: ReadonlySet<number>;
  readonly balance: readonly number[];
  readonly returns: number;
  readonly errors: ReadonlyArray<readonly [string, number]>;
  readonly veneers: ReadonlySet<number>;
  readonly adrs: ReadonlySet<number>;
  readonly tails: ReadonlySet<number>;
  readonly tailExits: number;
  readonly calls: readonly PocCall[];
  readonly codeEnd: number;
  readonly end: number;
}

interface PocSettled {
  readonly f: PocFunc;
  readonly far: ReadonlySet<number>;
}

interface PocAnalyzer {
  readonly funcs: ReadonlyMap<number, PocFunc>;
  readonly origin: ReadonlyMap<number, string>;
  readonly claimed: Uint8Array;
  readonly startup: { readonly entries: readonly number[]; readonly end: number };
  readonly codeRange: readonly [number, number];
  run(): void;
}

/** A method of the Analyzer prototype, private ones included (TypeScript's `private` is not a runtime boundary). */
type Method = (this: PocAnalyzer, ...args: unknown[]) => unknown;
type Prototype = Record<string, unknown>;

interface PocDataset {
  readonly name: string;
  readonly rom: string;
  readonly elf: string;
  readonly sha1?: string;
  readonly labels?: readonly unknown[];
  readonly untyped?: readonly unknown[];
}

interface AnalysisModule {
  readonly Analyzer: { new (rom: unknown): PocAnalyzer; readonly prototype: Prototype };
}
interface RomModule {
  readonly Rom: { load(path: string): unknown; readonly BASE: number };
}
interface TruthModule {
  readElfFunctions(path: string, rom: unknown): unknown;
}
interface ScoreModule {
  score(
    an: PocAnalyzer,
    truth: unknown,
  ): { readonly fn: ReadonlyArray<{ readonly addr: number; readonly reason: string }> };
}
interface DatasetModule {
  readonly BENCH_ROOT: string;
  loadDatasets(only?: string): readonly PocDataset[];
}
interface RunModule {
  runRom(d: PocDataset, opts: { scaffold: boolean }): unknown;
}
interface PocLabel {
  readonly addr: number;
  readonly name: string;
  readonly note?: string;
}
interface PocChunk {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly kind: 'func' | 'gap';
  readonly mode: 'thumb' | 'arm' | 'none';
  readonly labels: readonly PocLabel[];
  readonly module: string;
}
interface EmitModule {
  tile(an: PocAnalyzer): { readonly chunks: readonly PocChunk[] };
  writeGenerated(an: PocAnalyzer, outDir: string, name: string): string;
}

const hexAddr = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const byNumber = (a: number, b: number): number => a - b;
const byFirst = (a: readonly [number, ...unknown[]], b: readonly [number, ...unknown[]]): number => a[0] - b[0];
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function load(pocRoot: string, file: string): Promise<unknown> {
  const module: unknown = await import(pathToFileURL(join(pocRoot, 'src', file)).href);
  return module;
}

/**
 * The PoC's own dataset of that name; else the tuning dataset romlift's parent passed in
 * ROMLIFT_POC_DATASET ({name, rom, elf, sha1, labels, untyped}), for a ROM that became tuning data after the
 * PoC was pinned (tmc, D60). The PoC is never written: its dataset directory is only read.
 */
function datasetNamed(all: readonly PocDataset[], name: string): PocDataset {
  return datasetUsed(all, name).dataset;
}

/** datasetNamed, and whether the dataset is the PoC's own file ('poc') or the one romlift handed over ('given'). */
function datasetUsed(
  all: readonly PocDataset[],
  name: string,
): { readonly dataset: PocDataset; readonly source: 'poc' | 'given' } {
  const dataset = all.find((d) => d.name === name);
  if (dataset !== undefined) return { dataset, source: 'poc' };
  const given = process.env['ROMLIFT_POC_DATASET'];
  const parsed: unknown = given === undefined ? undefined : JSON.parse(given);
  const ok = (v: unknown): v is PocDataset =>
    typeof v === 'object' &&
    v !== null &&
    (v as PocDataset).name === name &&
    typeof (v as PocDataset).rom === 'string' &&
    typeof (v as PocDataset).elf === 'string' &&
    typeof (v as PocDataset).sha1 === 'string' &&
    Array.isArray((v as PocDataset).labels) &&
    Array.isArray((v as PocDataset).untyped);
  if (!ok(parsed)) throw new Error(`the PoC has no dataset named ${name}, and ROMLIFT_POC_DATASET gives none`);
  return { dataset: parsed, source: 'given' };
}

// ---------------------------------------------------------------- scored mode (phase 1)

function analysisOf(an: PocAnalyzer): unknown {
  const entries = Array.from(an.funcs.keys()).sort(byNumber);
  const functions = entries.map((entry) => {
    const f = an.funcs.get(entry);
    if (f === undefined) throw new Error(`no function at ${hexAddr(entry)}`);
    return { entry: hexAddr(entry), mode: f.mode, end: hexAddr(f.end), origin: an.origin.get(entry) ?? '' };
  });
  const startup = an.startup;
  const [lo, hi] = an.codeRange;
  return {
    functions,
    startup: { end: hexAddr(startup.end), entries: startup.entries.map(hexAddr) },
    codeRange: [hexAddr(lo), hexAddr(hi)],
  };
}

async function scored(pocRoot: string, name: string): Promise<void> {
  const { Analyzer } = (await load(pocRoot, 'analysis.ts')) as AnalysisModule;
  const { Rom } = (await load(pocRoot, 'rom.ts')) as RomModule;
  const { readElfFunctions } = (await load(pocRoot, 'truth.ts')) as TruthModule;
  const { score } = (await load(pocRoot, 'score.ts')) as ScoreModule;
  const { BENCH_ROOT, loadDatasets } = (await load(pocRoot, 'bench/dataset.ts')) as DatasetModule;
  const { runRom } = (await load(pocRoot, 'bench/run.ts')) as RunModule;

  const { dataset, source } = datasetUsed(loadDatasets(name), name);
  const rom = Rom.load(join(BENCH_ROOT, dataset.rom));
  const analyses: unknown[] = [];
  let first: PocAnalyzer | undefined;
  for (let k = 0; k < 2; k++) {
    const an = new Analyzer(rom);
    an.run();
    analyses.push(analysisOf(an));
    first ??= an;
    console.error(`${name}: analysis ${k + 1} of 2 done`);
  }
  if (first === undefined) throw new Error('no analysis ran');
  const truth = readElfFunctions(join(BENCH_ROOT, dataset.elf), rom);
  const misses = [...score(first, truth).fn]
    .sort((a, b) => a.addr - b.addr)
    .map((m) => ({ addr: hexAddr(m.addr), reason: m.reason }));
  console.error(`${name}: running the PoC's own bench row with its scaffold`);
  const row = runRom(dataset, { scaffold: true });
  process.stdout.write(`${JSON.stringify({ analyses, misses, row, dataset: source })}\n`);
}

// ---------------------------------------------------------------- canonical JSON and readings

/** Canonical JSON of plain data (keys by code unit, no whitespace): romlift's canonicalJson, for the values written here. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort(byCodeUnit);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * The instructions as runs `[start, len, count]`: `count` instructions of `len` bytes at `start`,
 * `start + len`, …; consecutive instructions of one length share a run. bench/src/poc-log.ts expands
 * them back to `[addr, len]` pairs.
 */
function insnRuns(insns: ReadonlyMap<number, number>): number[][] {
  const runs: number[][] = [];
  let last: [number, number, number] | undefined;
  for (const [a, n] of [...insns].sort(byFirst)) {
    if (last !== undefined && last[1] === n && last[0] + n * last[2] === a) last[2]++;
    else runs.push((last = [a, n, 1]));
  }
  return runs;
}

/** One Func as the reading of readings.ndjson, read at the time of the call. */
function readingOf(f: PocFunc): unknown {
  return {
    adrs: [...f.adrs].sort(byNumber),
    balance: [...f.balance],
    blSites: f.blSites.map(([site, target]) => [site, target]),
    calls: f.calls.map((c) => [c.target, c.mode, c.site]),
    codeEnd: f.codeEnd,
    deadEnd: [...f.deadEnd].sort(byNumber),
    end: f.end,
    entry: f.entry,
    errors: f.errors.map(([reason, at]) => [reason, at]),
    insnRuns: insnRuns(f.insns),
    mode: f.mode,
    pools: [...f.pools].sort(byFirst).map(([a, v]) => [a, v]),
    returns: f.returns,
    tables: [...f.tables].sort(byFirst).map(([b, t]) => [b, [...t]]),
    tailExits: f.tailExits,
    tails: [...f.tails].sort(byNumber),
    veneers: [...f.veneers].sort(byNumber),
  };
}

// ---------------------------------------------------------------- the parity view

/** far and noret of every Thumb Func, the Sets settle passed to the analyzeThumb call that built it. */
type SettleSets = WeakMap<PocFunc, { readonly far: ReadonlySet<number>; readonly noret: ReadonlySet<number> }>;

/**
 * Wraps analyzeThumb so that each Func it returns remembers its far and noret Sets. settle keeps one
 * pair of Sets per call and returns the Func of its last analyzeThumb call, so the Sets remembered for
 * an accepted Func are that settle's final far and noret sets.
 */
function captureSettleSets(proto: Prototype): SettleSets {
  const sets: SettleSets = new WeakMap();
  const original = proto['analyzeThumb'];
  if (typeof original !== 'function') throw new Error("the PoC's Analyzer has no method analyzeThumb");
  const call = original as Method;
  proto['analyzeThumb'] = function (this: PocAnalyzer, ...args: unknown[]): unknown {
    const f = call.apply(this, args) as PocFunc;
    sets.set(f, { far: args[1] as ReadonlySet<number>, noret: args[2] as ReadonlySet<number> });
    return f;
  };
  return sets;
}

/** Maximal runs of instruction bytes, `[start, end)`. */
function codeRuns(insns: ReadonlyMap<number, number>): number[][] {
  const runs: [number, number][] = [];
  for (const [a, n] of [...insns].sort(byFirst)) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last[1] >= a) last[1] = Math.max(last[1], a + n);
    else runs.push([a, a + n]);
  }
  return runs;
}

/** Maximal runs of equal nonzero claim kinds, `[start, end, kind]`, as bus addresses. */
function claimRuns(claimed: Uint8Array, base: number): number[][] {
  const runs: number[][] = [];
  let k = 0;
  while (k < claimed.length) {
    const kind = claimed[k] ?? 0;
    let e = k + 1;
    while (e < claimed.length && claimed[e] === kind) e++;
    if (kind !== 0) runs.push([base + k, base + e, kind]);
    k = e;
  }
  return runs;
}

function parityOf(an: PocAnalyzer, sets: SettleSets, base: number): unknown {
  const functions = [...an.funcs.keys()].sort(byNumber).map((entry) => {
    const f = an.funcs.get(entry);
    if (f === undefined) throw new Error(`no function at ${hexAddr(entry)}`);
    let far: number[] = [];
    let noreturn: number[] = [];
    if (f.mode === 'thumb') {
      const s = sets.get(f);
      if (s === undefined) throw new Error(`the Thumb function at ${hexAddr(entry)} was not built by settle`);
      far = [...s.far].sort(byNumber);
      noreturn = [...s.noret].sort(byNumber);
    }
    const origin = an.origin.get(entry);
    if (origin === undefined) throw new Error(`the function at ${hexAddr(entry)} has no origin`);
    return {
      entry,
      mode: f.mode,
      end: f.end,
      codeEnd: f.codeEnd,
      code: codeRuns(f.insns),
      pools: [...f.pools.keys()].sort(byNumber),
      tables: [...f.tables].sort(byFirst).map(([b, t]) => [b, t.length]),
      far,
      noreturn,
      origin: origin.replace(/ /g, '-'),
    };
  });
  const { entries, end } = an.startup;
  return {
    schema: 'romlift-bench/parity@1',
    functions,
    claims: claimRuns(an.claimed, base),
    startup: { end, entries: [...entries] },
    codeEnd: an.codeRange[1],
  };
}

// ---------------------------------------------------------------- the queries log

/** A buffered NDJSON file, written to `<path>.tmp` and renamed into place by `commit`, which returns its size. */
interface LineSink {
  line(text: string): void;
  commit(): number;
}

function lineSink(path: string): LineSink {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  let chunks: string[] = [];
  let pending = 0;
  let bytes = 0;
  const flush = (): void => {
    if (chunks.length === 0) return;
    bytes += writeSync(fd, chunks.join(''));
    chunks = [];
    pending = 0;
  };
  return {
    line(text: string): void {
      chunks.push(text, '\n');
      pending += text.length + 1;
      if (pending >= 1 << 22) flush();
    },
    commit(): number {
      flush();
      closeSync(fd);
      renameSync(tmp, path);
      return bytes;
    },
  };
}

interface QueryRecord {
  readonly seq: number;
  readonly parent: number | null;
  readonly epoch: number;
  readonly method: string;
  args: readonly unknown[];
  result: unknown;
  done: boolean;
}

/** How one method's arguments and result are written, at the call's return (units in poc-log.ts). */
type Encode = (
  an: PocAnalyzer,
  args: readonly unknown[],
  result: unknown,
) => { readonly args: readonly unknown[]; readonly result: unknown };

interface LogStats {
  readonly queries: number;
  readonly readings: number;
  readonly queryBytes: number;
  readonly readingBytes: number;
}

interface Recorder {
  /** Closes both files and moves them into place; throws when a recorded call never returned. */
  commit(): LogStats;
}

function adrOwner(an: PocAnalyzer, target: number): PocFunc | undefined {
  const owners = (an as unknown as { readonly adrOwner: ReadonlyMap<number, PocFunc> }).adrOwner;
  return owners.get(target);
}

/** Wraps every recorded method of the prototype; records go to `<out>/queries.ndjson`, readings to `<out>/readings.ndjson`. */
function recordQueries(proto: Prototype, sets: SettleSets, base: number, out: string, header: unknown): Recorder {
  const queries = lineSink(join(out, 'queries.ndjson'));
  const readings = lineSink(join(out, 'readings.ndjson'));
  queries.line(JSON.stringify(header));

  // One key per Func identity; absorbBlock drops the key of the Func it merges a block into.
  const keyOf = new WeakMap<PocFunc, string>();
  const written = new Set<string>();
  const reading = (f: PocFunc): { readonly reading: string } => {
    let key = keyOf.get(f);
    if (key === undefined) {
      const text = canonical(readingOf(f));
      key = sha256(text);
      keyOf.set(f, key);
      if (!written.has(key)) {
        written.add(key);
        readings.line(`{"key":${JSON.stringify(key)},"reading":${text}}`);
      }
    }
    return { reading: key };
  };
  const funcOrNull = (r: unknown): { readonly reading: string } | null => (r === null ? null : reading(r as PocFunc));
  const verbatim: Encode = (_an, args, result) => ({ args, result });
  const readingResult: Encode = (_an, args, result) => ({ args, result: funcOrNull(result) });

  const methods: Readonly<Record<string, Encode>> = {
    valid: verbatim,
    whyInvalid: verbatim,
    couldBeCode: verbatim,
    inPointerTable: verbatim,
    absorbBlock: verbatim,
    settle: (_an, args, result) => {
      const s = result as PocSettled;
      const noret = sets.get(s.f)?.noret;
      if (noret === undefined)
        throw new Error(`settle(${hexAddr(Number(args[0]))}) returned a Func analyzeThumb did not build`);
      return { args, result: { ...reading(s.f), far: [...s.far].sort(byNumber), noret: [...noret].sort(byNumber) } };
    },
    acceptable: (_an, args, result) => ({ args: [(args[0] as PocFunc).entry, args[1]], result }),
    thumbCandidate: readingResult,
    holeHead: readingResult,
    tryTiledHole: readingResult,
    armAhead: (_an, args, result) => {
      if (result === null) return { args, result: null };
      const [at, f] = result as readonly [number, PocFunc];
      return { args, result: [at, reading(f)] };
    },
    pointerCandidates: (_an, args, result) => {
      const [pool, data] = result as readonly [readonly number[], readonly number[]];
      return { args, result: { pool: [...pool], data: [...data] } };
    },
    analyzeArm: (_an, args, result) => ({ args, result: reading(result as PocFunc) }),
    forgetCandidates: (_an, args) => ({ args, result: null }),
    claim: (an, args) => {
      const f = args[0] as PocFunc;
      return {
        args: [f.entry],
        result: {
          entry: f.entry,
          mode: f.mode,
          origin: an.origin.get(f.entry) ?? null,
          absorbed: !an.funcs.has(f.entry),
        },
      };
    },
  };

  // Records are written in call order: a record waits until it and every earlier record have returned.
  const pending: QueryRecord[] = [];
  let head = 0;
  const stack: number[] = [];
  let seq = 0;
  let epoch = 0;
  const flush = (): void => {
    for (let r = pending[head]; r !== undefined && r.done; r = pending[++head]) {
      queries.line(
        JSON.stringify({
          seq: r.seq,
          parent: r.parent,
          epoch: r.epoch,
          method: r.method,
          args: r.args,
          result: r.result,
        }),
      );
    }
    if (head === pending.length) {
      pending.length = 0;
      head = 0;
    }
  };

  for (const name of Object.keys(methods).sort(byCodeUnit)) {
    const encode = methods[name];
    const original = proto[name];
    if (encode === undefined || typeof original !== 'function')
      throw new Error(`the PoC's Analyzer has no method ${name}`);
    const call = original as Method;
    proto[name] = function (this: PocAnalyzer, ...args: unknown[]): unknown {
      if (name === 'forgetCandidates') epoch++;
      // absorbBlock(p, …) merges the block at p into the function that computes it with adr.
      const owner = name === 'absorbBlock' ? adrOwner(this, base + Number(args[0])) : undefined;
      const record: QueryRecord = {
        seq: seq++,
        parent: stack[stack.length - 1] ?? null,
        epoch,
        method: name,
        args: [],
        result: null,
        done: false,
      };
      pending.push(record);
      stack.push(record.seq);
      let result: unknown;
      try {
        result = call.apply(this, args);
      } finally {
        stack.pop();
      }
      if (owner !== undefined && result !== null) keyOf.delete(owner);
      // Encoded at the return: claim(f) reports the origin accept recorded just before it.
      const encoded = encode(this, args, result);
      record.args = encoded.args;
      record.result = encoded.result;
      record.done = true;
      flush();
      return result;
    };
  }
  return {
    commit(): LogStats {
      if (stack.length !== 0 || pending.length !== 0)
        throw new Error('the queries log holds calls that never returned');
      const queryBytes = queries.commit();
      const readingBytes = readings.commit();
      return { queries: seq, readings: written.size, queryBytes, readingBytes };
    },
  };
}

// ---------------------------------------------------------------- parity and queries modes

interface Loaded {
  readonly Analyzer: AnalysisModule['Analyzer'];
  readonly rom: unknown;
  readonly base: number;
}

async function loadAnalyzer(pocRoot: string, name: string): Promise<Loaded> {
  const { Analyzer } = (await load(pocRoot, 'analysis.ts')) as AnalysisModule;
  const { Rom } = (await load(pocRoot, 'rom.ts')) as RomModule;
  const { BENCH_ROOT, loadDatasets } = (await load(pocRoot, 'bench/dataset.ts')) as DatasetModule;
  const dataset = datasetNamed(loadDatasets(name), name);
  return { Analyzer, rom: Rom.load(join(BENCH_ROOT, dataset.rom)), base: Rom.BASE };
}

const secondsSince = (started: bigint): number => Number(process.hrtime.bigint() - started) / 1e9;

async function parity(pocRoot: string, name: string): Promise<void> {
  const { Analyzer, rom, base } = await loadAnalyzer(pocRoot, name);
  const sets = captureSettleSets(Analyzer.prototype);
  const started = process.hrtime.bigint();
  const an = new Analyzer(rom);
  an.run();
  const seconds = secondsSince(started);
  console.error(`${name}: parity analysis done in ${seconds.toFixed(1)} s`);
  process.stdout.write(`${JSON.stringify({ parity: parityOf(an, sets, base), seconds })}\n`);
}

async function queries(
  pocRoot: string,
  name: string,
  out: string,
  sha1: string,
  pocSourceDigest: string,
): Promise<void> {
  outsidePoc(pocRoot, out);
  const { Analyzer, rom, base } = await loadAnalyzer(pocRoot, name);
  mkdirSync(out, { recursive: true });
  const sets = captureSettleSets(Analyzer.prototype);
  const header = {
    schema: 'romlift-bench/poc-queries@1',
    rom: name,
    sha1,
    pocSourceDigest,
    readings: 'readings.ndjson',
  };
  const recorder = recordQueries(Analyzer.prototype, sets, base, out, header);
  const started = process.hrtime.bigint();
  const an = new Analyzer(rom);
  an.run();
  const stats = recorder.commit();
  const seconds = secondsSince(started);
  console.error(`${name}: ${stats.queries} queries, ${stats.readings} readings in ${seconds.toFixed(1)} s`);
  process.stdout.write(`${JSON.stringify({ parity: parityOf(an, sets, base), ...stats, seconds })}\n`);
}

// ---------------------------------------------------------------- raw mode (phase 3)

/** Refuses an output directory inside the PoC checkout: the PoC is read-only. */
function outsidePoc(pocRoot: string, out: string): void {
  const inside = relative(resolve(pocRoot), resolve(out));
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside)))
    throw new Error(`refusing to write inside the PoC checkout: ${out}`);
}

async function raw(pocRoot: string, name: string, romPath: string, out: string): Promise<void> {
  outsidePoc(pocRoot, out);
  const { Analyzer } = (await load(pocRoot, 'analysis.ts')) as AnalysisModule;
  const { Rom } = (await load(pocRoot, 'rom.ts')) as RomModule;
  const { tile, writeGenerated } = (await load(pocRoot, 'emit.ts')) as EmitModule;
  const an = new Analyzer(Rom.load(romPath));
  an.run();
  mkdirSync(out, { recursive: true });
  const summary = writeGenerated(an, out, name);
  // tile() is what writeGenerated tiles with; it is deterministic, so a second call gives the same chunks.
  const chunks = tile(an).chunks.map((c) => ({
    start: c.start,
    end: c.end,
    name: c.name,
    kind: c.kind,
    mode: c.mode,
    module: c.module,
    labels: c.labels.map((l) =>
      l.note === undefined ? { addr: l.addr, name: l.name } : { addr: l.addr, name: l.name, note: l.note },
    ),
  }));
  console.error(`${name}: ${summary}`);
  process.stdout.write(`${JSON.stringify({ summary, chunks, claims: [...an.claimed] })}\n`);
}

async function main(): Promise<void> {
  const [name, mode, ...rest] = process.argv.slice(2);
  const pocRoot = process.env['ROMLIFT_POC'];
  const usage =
    'usage: ROMLIFT_POC=<poc> tsx export-poc-child.ts <dataset> scored|parity|queries [<out dir> <rom sha1> <poc source digest>] | <fixture> raw <rom path> <out dir>';
  if (name === undefined || pocRoot === undefined) throw new Error(usage);
  // The PoC may log; stdout carries only the one JSON document.
  console.log = (...args: unknown[]): void => console.error(...args);
  if (mode === 'scored') await scored(pocRoot, name);
  else if (mode === 'parity') await parity(pocRoot, name);
  else if (mode === 'queries' && rest.length === 3) {
    const [out = '', sha1 = '', digest = ''] = rest;
    await queries(pocRoot, name, out, sha1, digest);
  } else if (mode === 'raw' && rest.length === 2) {
    const [romPath = '', out = ''] = rest;
    await raw(pocRoot, name, romPath, out);
  } else throw new Error(usage);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
