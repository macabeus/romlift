// Runs inside the PoC's own tsx (spawned by export-poc.ts) and prints one JSON document on stdout:
// two analyses of one dataset's ROM by the PoC's Analyzer, the PoC's miss diagnoses against its own
// ELF truth, and the PoC's own bench row with its scaffold built (scaffold, make, generate, make, in
// os.tmpdir()/romlift-bench/<name>). It imports only node:* and the PoC's modules, by non-literal
// dynamic import from ROMLIFT_POC, typed through the local interfaces below; it never writes inside
// the PoC checkout. Usage: tsx export-poc-child.ts <dataset name>
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Mode = 'thumb' | 'arm';

interface PocFunc {
  readonly entry: number;
  readonly mode: Mode;
  readonly end: number;
}

interface PocAnalyzer {
  readonly funcs: ReadonlyMap<number, PocFunc>;
  readonly origin: ReadonlyMap<number, string>;
  readonly startup: { readonly entries: readonly number[]; readonly end: number };
  readonly codeRange: readonly [number, number];
  run(): void;
}

interface PocDataset {
  readonly name: string;
  readonly rom: string;
  readonly elf: string;
}

interface AnalysisModule {
  readonly Analyzer: new (rom: unknown) => PocAnalyzer;
}
interface RomModule {
  readonly Rom: { load(path: string): unknown };
}
interface TruthModule {
  readElfFunctions(path: string, rom: unknown): unknown;
}
interface ScoreModule {
  score(an: PocAnalyzer, truth: unknown): { readonly fn: ReadonlyArray<{ readonly addr: number; readonly reason: string }> };
}
interface DatasetModule {
  readonly BENCH_ROOT: string;
  loadDatasets(only?: string): readonly PocDataset[];
}
interface RunModule {
  runRom(d: PocDataset, opts: { scaffold: boolean }): unknown;
}

const hexAddr = (v: number): string => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

async function load(pocRoot: string, file: string): Promise<unknown> {
  const module: unknown = await import(pathToFileURL(join(pocRoot, 'src', file)).href);
  return module;
}

function analysisOf(an: PocAnalyzer): unknown {
  const entries = Array.from(an.funcs.keys()).sort((a, b) => a - b);
  const functions = entries.map((entry) => {
    const f = an.funcs.get(entry);
    if (f === undefined) throw new Error(`no function at ${hexAddr(entry)}`);
    return { entry: hexAddr(entry), mode: f.mode, end: hexAddr(f.end), origin: an.origin.get(entry) ?? '' };
  });
  const startup = an.startup;
  const [lo, hi] = an.codeRange;
  return { functions, startup: { end: hexAddr(startup.end), entries: startup.entries.map(hexAddr) }, codeRange: [hexAddr(lo), hexAddr(hi)] };
}

async function main(): Promise<void> {
  const name = process.argv[2];
  const pocRoot = process.env['ROMLIFT_POC'];
  if (name === undefined || pocRoot === undefined) throw new Error('usage: ROMLIFT_POC=<poc> tsx export-poc-child.ts <dataset>');
  // The PoC may log; stdout carries only the one JSON document.
  console.log = (...args: unknown[]): void => console.error(...args);
  const { Analyzer } = (await load(pocRoot, 'analysis.ts')) as AnalysisModule;
  const { Rom } = (await load(pocRoot, 'rom.ts')) as RomModule;
  const { readElfFunctions } = (await load(pocRoot, 'truth.ts')) as TruthModule;
  const { score } = (await load(pocRoot, 'score.ts')) as ScoreModule;
  const { BENCH_ROOT, loadDatasets } = (await load(pocRoot, 'bench/dataset.ts')) as DatasetModule;
  const { runRom } = (await load(pocRoot, 'bench/run.ts')) as RunModule;

  const dataset = loadDatasets(name).find((d) => d.name === name);
  if (dataset === undefined) throw new Error(`the PoC has no dataset named ${name}`);
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
  process.stdout.write(`${JSON.stringify({ analyses, misses, row })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
