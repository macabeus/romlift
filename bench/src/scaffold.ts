// The emission families of one tuning ROM (architecture §8.4 "Scaffold", "Readability", "objdiff", D34,
// D62): the model of the seedless discover run (romlift's discoverModel: configFromDiscover, buildModel), the
// readable printer's statistics and tree digest on every `bench run`, and under `--scaffold` both printers' trees
// each written into a fresh temporary directory (writeFreshTree) and linked with linkCheck,
// then the objdiff family over the readable build when it reproduces the SHA-1. The raw link is the row's
// `scaffold` verdict from phase 3 on (it replaces the PoC dump's); the readable link is `objdiff.linked`.
// From phase 4 (roadmap 4.E, architecture §8.4 "Scaffold") `--scaffold` also builds every ROM as a user does: in a
// fresh temporary directory holding only the ROM as baserom.gba, `romlift init` (the CLI from source, under the bin's
// heap cap), `./setup.sh` with ROMLIFT_CLI set to that CLI, then `make`, and the built ROM's SHA-1 against the ROM's
// (initBuild). tools/agbcc is copied into each project from a cache built once from templates/agbcc.json's pin
// (bench/.local/agbcc, gitignored; agbccCache), so setup.sh never builds the compiler there. A sealed ROM's build
// keeps no output (`withhold`): its verdict holds exit codes and a boolean only.
// The bench reaches all of it through EmissionFamilies (named apart from emission-run.ts EmissionRunner, the
// generate and init workflows `bench speed` and `bench large-rom` time), so its tests run `bench run` on hand-built
// analyses.
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildUnits,
  decodeAgbccPin,
  discoverModel as modelOfDiscover,
  emitTree,
  BASEROM_FILE,
  type AgbccPin,
  type AnalysisResult,
  type ElfSymbol,
  type Model,
  type Printer,
  type PrintStats,
  type Rom,
} from 'romlift';
import { linkCheck, sha1Of, writeFreshTree } from 'romlift/node';

import type { BenchContext } from './context.ts';
import { BenchError, exists } from './files.ts';
import { CLI_MAIN, launcherOptions } from './large-rom-bin.ts';
import { scoreObjdiff, unlinkedSummary, type ObjdiffSummary } from './objdiff.ts';
import { runProcess, type ProcessOptions, type ProcessResult } from './process.ts';
import { readableStats, treePass } from './readability.ts';
import type { Truth } from './truth.ts';

/** What linking one printer's tree gave. */
export interface LinkOutcome {
  /** The image linked and its SHA-1 is the ROM's. */
  readonly ok: boolean;
  /** The SHA-1 of the linked image; null when nothing linked. */
  readonly sha1: string | null;
  readonly detail: string;
  readonly treeDigest: string;
}

/** The readability family's inputs of one ROM. */
export interface ReadabilityRun {
  readonly stats: PrintStats;
  /** The readable emission stream's digest (g3.tree-determinism's). */
  readonly treeDigest: string;
}

export interface ScaffoldInput {
  readonly rom: Rom;
  readonly analysis: AnalysisResult;
  readonly truth: Pick<Truth, 'byAddr'>;
  /** The reference ELF's symbols, for the names of the objdiff base. */
  readonly symbols: readonly ElfSymbol[];
  /** The reference objects (absolute). */
  readonly objectsDir: string;
  /** The objects the reference map links, relative to objectsDir (objdiff.ts ObjdiffInputs.linkedObjects). */
  readonly linkedObjects?: ReadonlySet<string>;
  /** The objdiff-cli binary. */
  readonly objdiff: string;
}

export interface ScaffoldRun {
  readonly raw: LinkOutcome;
  readonly readable: LinkOutcome;
  readonly objdiff: ObjdiffSummary;
  /** Volatile wall times in milliseconds (bench/timings.json). */
  readonly timings: Readonly<Record<string, number>>;
}

/** One ROM built through `init`, `setup.sh` and `make` (`bench run --scaffold`, phase 4). */
export interface InitBuildInput {
  readonly cx: BenchContext;
  readonly rom: Rom;
  /** A sealed ROM: no output of any step is kept (D25); the detail says only which step failed. */
  readonly withhold: boolean;
}

/**
 * The verdict of one init build, as the artifact keeps it (a tuning row's `scaffold.init`, a sealed entry's `init`):
 * each step's exit code, NOT_RUN for a step an earlier failure skipped, and whether the ROM `make` built has the
 * ROM's SHA-1. Counts and a boolean only, so a sealed entry can hold it (seal.ts assertCountsOnly).
 */
export interface InitBuildVerdict {
  readonly initExit: number;
  readonly setupExit: number;
  readonly makeExit: number;
  readonly sha1Match: boolean;
}

/** An init build's verdict with its volatile wall time (bench/timings.json) and what failed. */
export interface InitBuild extends InitBuildVerdict {
  /** Wall time of the three steps, in seconds to a tenth. */
  readonly seconds: number;
  /** 'SHA-1 match', or the first failure (with its output's tail unless withheld). */
  readonly detail: string;
}

/** How `bench run` reaches the emission families (readability, scaffold, objdiff, the init build). */
export interface EmissionFamilies {
  readability(rom: Rom, analysis: AnalysisResult): ReadabilityRun;
  scaffold(input: ScaffoldInput): Promise<ScaffoldRun>;
  /** The ROM built as a user builds it: `romlift init`, `./setup.sh`, `make` (phase 4). */
  initBuild(input: InitBuildInput): Promise<InitBuild>;
}

const MODELS = new WeakMap<AnalysisResult, Model>();

/** The model of a discover run under the config configFromDiscover builds, once per analysis. */
export function discoverModel(rom: Rom, analysis: AnalysisResult): Model {
  const cached = MODELS.get(analysis);
  if (cached !== undefined) return cached;
  const model = modelOfDiscover(rom, analysis);
  MODELS.set(analysis, model);
  return model;
}

const EMPTY_DECOMP = { defined: [] };

const messages = (diagnostics: readonly { readonly message: string }[]): string => diagnostics.map((d) => d.message).join('; ');

/**
 * Writes `printer`'s tree of `model` into the empty directory `dir` as a fresh project is written
 * (writeFreshTree), then links it. The stream runs twice: once for the paths and the tree digest, once for the
 * write.
 */
export async function scaffoldTree(rom: Rom, model: Model, printer: Printer, dir: string): Promise<LinkOutcome> {
  const cx = { decomp: EMPTY_DECOMP, printer };
  const pass = treePass(emitTree(rom, model, cx));
  const failed = (detail: string): LinkOutcome => ({ ok: false, sha1: null, detail, treeDigest: pass.treeDigest });
  const applied = await writeFreshTree(dir, { model, entries: emitTree(rom, model, cx), paths: pass.paths });
  if (!applied.ok) return failed(`applying the plan: ${messages(applied.diagnostics)}`);
  const link = await linkCheck({ dir, rom, units: buildUnits(model) });
  const detail = link.diagnostics.length === 0 ? link.detail : `${link.detail}: ${messages(link.diagnostics)}`;
  return { ok: link.ok && link.sha1 === rom.sha1, sha1: link.sha1, detail, treeDigest: pass.treeDigest };
}

/** scaffoldTree in a temporary directory that is removed afterwards. */
async function inTempDir(rom: Rom, model: Model, printer: Printer): Promise<LinkOutcome> {
  const dir = await mkdtemp(join(tmpdir(), `romlift-scaffold-${printer}-`));
  try {
    return await scaffoldTree(rom, model, printer, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const since = (started: number): number => Math.round(performance.now() - started);

// ---------------------------------------------------------------- the init build

/** The exit code recorded for a step that did not run because an earlier one failed. */
export const NOT_RUN = -1;

/** Runs a command to its end; never throws for a nonzero exit (process.ts runProcess). */
export type CommandRunner = (command: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessResult>;

/** The agbcc cache of `bench run --scaffold`: tools/agbcc as pret/agbcc's install.sh lays it out (bin, include, lib). */
export const agbccCachePath = (cx: BenchContext): string => join(cx.repoRoot, 'bench', '.local', 'agbcc');
/** The pin the cache was built from, beside it; a cache whose pin differs from templates/agbcc.json is rebuilt. */
export const AGBCC_CACHE_PIN = 'romlift-agbcc-pin.json';
const AGBCC_BINARIES = ['agbcc', 'old_agbcc'] as const;

/** templates/agbcc.json, the pin `init` writes into every project's setup.sh. */
export async function readAgbccPin(cx: BenchContext): Promise<AgbccPin> {
  const file = join(cx.repoRoot, 'templates', 'agbcc.json');
  const decoded = decodeAgbccPin(await readFile(file, 'utf8'));
  if (!decoded.ok) throw new BenchError(`${file}: ${decoded.message}`);
  return decoded.value;
}

/** Whether `dir` is an agbcc cache built from `pin`: both compilers present and the pin file equal. */
export async function agbccCacheCurrent(dir: string, pin: AgbccPin): Promise<boolean> {
  for (const bin of AGBCC_BINARIES) if (!(await exists(join(dir, 'bin', bin)))) return false;
  const stamp = join(dir, AGBCC_CACHE_PIN);
  if (!(await exists(stamp))) return false;
  return (await readFile(stamp, 'utf8')) === pinText(pin);
}

/** The text of an agbcc cache's pin stamp (AGBCC_CACHE_PIN). */
export const pinText = (pin: AgbccPin): string => `${JSON.stringify({ url: pin.url, commit: pin.commit })}\n`;

const tail = (run: ProcessResult, lines = 20): string => `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');

export interface AgbccCacheDeps {
  readonly run: CommandRunner;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
}

/**
 * Where the pinned agbcc is fetched from: AGBCC_URL when set (setup.sh's mirror variable), else the benchmark root's
 * `agbcc/` checkout when it holds the pinned commit (no network), else the pin's URL.
 */
export async function agbccSource(cx: BenchContext, pin: AgbccPin, deps: Pick<AgbccCacheDeps, 'run' | 'env'>): Promise<string> {
  const mirror = deps.env['AGBCC_URL'];
  if (mirror !== undefined && mirror !== '') return mirror;
  const local = join(cx.benchRoot, 'agbcc');
  if ((await exists(join(local, '.git'))) && (await deps.run('git', ['-C', local, 'cat-file', '-e', `${pin.commit}^{commit}`], {})).code === 0) return local;
  return pin.url;
}

/**
 * The agbcc cache, built once: pret/agbcc fetched at templates/agbcc.json's commit into a temporary directory, built by
 * its build.sh and installed by its install.sh (as setup.sh does), then moved to bench/.local/agbcc with the pin beside
 * it. A current cache is reused as it is. Throws a BenchError when a step fails.
 */
export async function agbccCache(cx: BenchContext, deps: AgbccCacheDeps): Promise<string> {
  const pin = await readAgbccPin(cx);
  const cache = agbccCachePath(cx);
  if (await agbccCacheCurrent(cache, pin)) return cache;
  const source = await agbccSource(cx, pin, deps);
  deps.log(`agbcc: building ${pin.commit} from ${source} into ${cache} (once; a few minutes)`);
  const work = await mkdtemp(join(tmpdir(), 'romlift-agbcc-'));
  try {
    const src = join(work, 'agbcc');
    const root = join(work, 'install');
    await mkdir(src);
    await mkdir(root);
    const step = async (what: string, command: string, args: readonly string[], cwd: string): Promise<void> => {
      const run = await deps.run(command, args, { cwd });
      if (run.code !== 0) throw new BenchError(`agbcc: ${what} exited ${run.code}:\n${tail(run)}`);
    };
    await step('git init', 'git', ['init', '-q'], src);
    // A fetch by commit, as setup.sh tries first; a server that refuses one is fetched whole.
    if ((await deps.run('git', ['fetch', '-q', '--depth', '1', source, pin.commit], { cwd: src })).code !== 0) await step('git fetch', 'git', ['fetch', '-q', source], src);
    await step('git checkout', 'git', ['checkout', '-q', pin.commit], src);
    await step('build.sh', './build.sh', [], src);
    await step('install.sh', './install.sh', [root], src);
    const built = join(root, 'tools', 'agbcc');
    for (const bin of AGBCC_BINARIES) if (!(await exists(join(built, 'bin', bin)))) throw new BenchError(`agbcc: install.sh wrote no ${join('tools', 'agbcc', 'bin', bin)}`);
    await writeFile(join(built, AGBCC_CACHE_PIN), pinText(pin));
    await mkdir(join(cache, '..'), { recursive: true });
    await rm(cache, { recursive: true, force: true });
    await rename(built, cache);
    return cache;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** `text` as one single-quoted shell word. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/**
 * The shell script that runs the CLI from source with the bin's Node options (setup.sh's ROMLIFT_CLI, and init): the
 * one source-CLI shim of the bench and of test/helpers/e2e.ts.
 */
export function sourceCliScript(nodePath: string, nodeOptions: readonly string[], main: string): string {
  return `#!/bin/sh\nexec ${[nodePath, '--conditions=source', ...nodeOptions, main].map(shellQuote).join(' ')} "$@"\n`;
}

export interface InitBuildDeps {
  readonly run: CommandRunner;
  /** tools/agbcc to copy into the project (agbccCache). */
  readonly agbcc: string;
  /** The `romlift` command: an executable that runs the CLI (sourceCliScript). */
  readonly cli: string;
}

/** The ROM `make` built: the one named by the project's single `<name>.sha1` file (sha1sum format), as g4.e2e-real reads it. */
async function builtRom(dir: string): Promise<string | undefined> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sha1'));
  if (names.length !== 1 || names[0] === undefined) return undefined;
  const match = /^[0-9a-f]{40}\s+\*?(\S+)\s*$/m.exec(await readFile(join(dir, names[0]), 'utf8'));
  return match?.[1] === undefined ? undefined : join(dir, match[1]);
}

/**
 * Builds `rom` in the empty directory `dir` as a user does: the ROM as baserom.gba, `romlift init baserom.gba --json`,
 * tools/agbcc copied from the cache, `./setup.sh` and `make` (both with ROMLIFT_CLI), each step only after the one
 * before exited 0; then the built ROM's SHA-1 against the ROM's. Never throws for a failed step.
 */
export async function initBuild(rom: Rom, dir: string, withhold: boolean, deps: InitBuildDeps): Promise<InitBuild> {
  const started = performance.now();
  const env = { ROMLIFT_CLI: deps.cli };
  const exits = { initExit: NOT_RUN, setupExit: NOT_RUN, makeExit: NOT_RUN };
  const done = (sha1Match: boolean, detail: string): InitBuild => ({ ...exits, sha1Match, seconds: Math.round((performance.now() - started) / 100) / 10, detail });
  const failed = (step: string, run: ProcessResult): InitBuild => done(false, `${step} exited ${run.code}${withhold ? ' (output withheld: sealed)' : `:\n${tail(run)}`}`);
  await writeFile(join(dir, BASEROM_FILE), rom.bytes);
  const init = await deps.run(deps.cli, ['init', BASEROM_FILE, '--json'], { cwd: dir });
  exits.initExit = init.code;
  if (init.code !== 0) return failed('romlift init', init);
  await cp(deps.agbcc, join(dir, 'tools', 'agbcc'), { recursive: true });
  const setup = await deps.run('./setup.sh', [], { cwd: dir, env });
  exits.setupExit = setup.code;
  if (setup.code !== 0) return failed('./setup.sh', setup);
  const make = await deps.run('make', [], { cwd: dir, env });
  exits.makeExit = make.code;
  const built = await builtRom(dir);
  const sha1Match = built !== undefined && (await exists(built)) && sha1Of(new Uint8Array(await readFile(built))) === rom.sha1;
  if (make.code !== 0) return { ...failed('make', make), sha1Match };
  if (built === undefined) return done(false, 'the project has no single <name>.sha1 naming the ROM make builds');
  return done(sha1Match, sha1Match ? 'SHA-1 match' : withhold ? 'the built ROM differs' : `${built} does not have SHA-1 ${rom.sha1}`);
}

/** The verdict the artifact keeps of an init build (no time, no detail). */
export function initVerdict(build: InitBuildVerdict): InitBuildVerdict {
  return { initExit: build.initExit, setupExit: build.setupExit, makeExit: build.makeExit, sha1Match: build.sha1Match };
}

/** The romlift CLI from source as an executable script in `dir`, with the Node options of the bin's launcher. */
export async function sourceCli(dir: string): Promise<string> {
  const file = join(dir, 'romlift');
  await writeFile(file, sourceCliScript(process.execPath, launcherOptions(await readFile(CLI_MAIN, 'utf8')), CLI_MAIN), { mode: 0o755 });
  return file;
}

/** One cache per repository and process: the first init build of a run builds it, the others reuse the promise. */
const CACHES = new Map<string, Promise<string>>();

function cachedAgbcc(cx: BenchContext): Promise<string> {
  const known = CACHES.get(cx.repoRoot);
  if (known !== undefined) return known;
  const made = agbccCache(cx, { run: runProcess, env: process.env, log: (line) => process.stderr.write(`${line}\n`) });
  CACHES.set(cx.repoRoot, made);
  made.catch(() => CACHES.delete(cx.repoRoot));
  return made;
}

/** initBuild in a temporary directory removed afterwards, the CLI script beside the project (init wants it empty). */
export async function initBuildInTemp(input: InitBuildInput, run: CommandRunner = runProcess): Promise<InitBuild> {
  const agbcc = await cachedAgbcc(input.cx);
  const base = await mkdtemp(join(tmpdir(), 'romlift-init-build-'));
  try {
    const project = join(base, 'project');
    await mkdir(project);
    return await initBuild(input.rom, project, input.withhold, { run, agbcc, cli: await sourceCli(base) });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/** The emission of romlift itself. */
export const ROMLIFT_FAMILIES: EmissionFamilies = {
  readability(rom, analysis) {
    const model = discoverModel(rom, analysis);
    return { stats: readableStats(rom, model), treeDigest: treePass(emitTree(rom, model, { decomp: EMPTY_DECOMP })).treeDigest };
  },
  async scaffold(input) {
    const model = discoverModel(input.rom, input.analysis);
    let started = performance.now();
    const raw = await inTempDir(input.rom, model, 'raw');
    const rawLinkMs = since(started);
    started = performance.now();
    const readable = await inTempDir(input.rom, model, 'readable');
    const readableLinkMs = since(started);
    started = performance.now();
    const objdiff =
      readable.ok
        ? await scoreObjdiff({
            rom: input.rom,
            analysis: input.analysis,
            truth: input.truth,
            symbols: input.symbols,
            objectsDir: input.objectsDir,
            objdiff: input.objdiff,
            ...(input.linkedObjects === undefined ? {} : { linkedObjects: input.linkedObjects }),
          })
        : unlinkedSummary();
    return { raw, readable, objdiff, timings: { rawLinkMs, readableLinkMs, objdiffMs: since(started) } };
  },
  initBuild: (input) => initBuildInTemp(input),
};
