// The end-to-end harness (roadmap 4.E, architecture §8.1, §8.6, §10): what a test needs to run romlift the way a
// user does, in a directory that holds only a ROM, and then `./setup.sh` and `make` (the PoC's scaffold-and-make
// loop, src/bench/run.ts, through `init` instead of its scaffold call):
//   - a temporary project holding only the ROM (tempProject);
//   - a source-CLI shim for ROMLIFT_CLI, `node --conditions=source src/cli/main.ts` (writeSourceCli), since an
//     unpublished tree cannot come from the registry and setup.sh then skips its npm duty;
//   - romlift run with --json, its NDJSON parsed and its summary checked: the last line is
//     {"type":"summary","exitCode":n} with n the process's exit code (runRomlift, summaryProblem);
//   - the project's <name>.sha1 (`<sha1>  <file>`, sha1sum format) read (parseSha1Text, readSha1File);
//   - a file-tree snapshot (sha1, size and mtime per file) and its diff (snapshotTree, diffTrees);
//   - a per-run cache of tools/agbcc, so one run builds agbcc once: the first project's build, or a prebuilt
//     directory such as ROMLIFT_AGBCC, is copied into every later project before setup.sh, whose duty 2 then
//     finds it present (agbccCache);
//   - setup.sh and make run with a time limit (buildProject), and the whole loop (runEndToEnd).
// The interfaces are the frozen ones of D74 that g4.e2e-fixtures, g4.packed-e2e, g4.e2e-real and g4.worktree
// read; the gates keep their own copies, since they import romlift only through its entry points (D37). The source-CLI
// shim and the agbcc cache's pin check are bench/src/scaffold.ts's, the one implementation `bench run --scaffold` uses
// too (architecture-11): a cached or prebuilt agbcc that records another pin than templates/agbcc.json is refused.
// Every command runs with stdin closed (g4.cli-contract) through a CommandRunner, which the unit tests replace.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGBCC_CACHE_PIN, pinText, sourceCliScript } from '../../bench/src/scaffold.ts';
import { decodeAgbccPin } from '../../src/core/scaffold/vars.ts';
import type { AgbccPin } from '../../src/core/scaffold/vars.ts';
import { listSyntheticFixtures, type SyntheticFixture } from './fixtures.ts';

export { shellQuote } from '../../bench/src/scaffold.ts';

/** The repository root of this checkout. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------------------------------------------
// Commands.

export interface CommandResult {
  /** The exit code; 124 when the time limit killed it, 127 when it could not start, 128 + n for signal n. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface CommandOptions {
  readonly cwd?: string;
  /** Added to the inherited environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Kills the process (SIGKILL) past this many milliseconds. */
  readonly timeoutMs?: number;
}

/** How the harness runs a process; runCommand is the real one, and a unit test passes its own. */
export type CommandRunner = (command: string, args: readonly string[], options?: CommandOptions) => Promise<CommandResult>;

export const TIMED_OUT_CODE = 124;
export const NOT_STARTED_CODE = 127;

/**
 * Runs a process with stdin closed and its output collected; never throws for a nonzero exit. NODE_TEST_CONTEXT is
 * dropped from the environment (a nested `node --test` that inherits it reports to the parent and exits 0). Past
 * the time limit the whole process group is killed.
 */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, ...options.env };
    if (options.env?.['NODE_TEST_CONTEXT'] === undefined) delete env['NODE_TEST_CONTEXT'];
    // Its own process group, so the time limit kills what it started too (make's recipes, setup.sh's build), whose
    // inherited pipes would otherwise keep the result waiting.
    const child = spawn(command, [...args], { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            try {
              if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }, options.timeoutMs);
    const finish = (code: number, extra: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') + extra, timedOut });
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => finish(NOT_STARTED_CODE, `${error.message}\n`));
    child.on('close', (code, signal) => {
      if (timedOut) finish(TIMED_OUT_CODE, `timed out after ${options.timeoutMs ?? 0} ms\n`);
      else if (code !== null) finish(code, '');
      else finish(128 + (signal === null ? 0 : constants.signals[signal]), `killed by ${signal ?? 'a signal'}\n`);
    });
  });

/** The last `lines` lines of a command's output, for a failure message. */
export function outputTail(result: Pick<CommandResult, 'stdout' | 'stderr'>, lines = 30): string {
  return `${result.stdout}${result.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

// ---------------------------------------------------------------------------------------------------
// The source CLI.


export interface SourceCliOptions {
  /** Default this checkout. */
  readonly repoRoot?: string;
  /** Default the running Node. */
  readonly node?: string;
  /** V8's old-space cap in MiB, as the built bin's launcher line sets it (1,024, D72); default none, as the gates run. */
  readonly maxOldSpaceMiB?: number;
}

/** The text of a `romlift` shell script that runs the source CLI with every argument it is given (bench's sourceCliScript). */
export function sourceCliText(options: SourceCliOptions = {}): string {
  const main = path.join(options.repoRoot ?? REPO_ROOT, 'src', 'cli', 'main.ts');
  const heap = options.maxOldSpaceMiB === undefined ? [] : [`--max-old-space-size=${options.maxOldSpaceMiB}`];
  return sourceCliScript(options.node ?? process.execPath, heap, main);
}

/** Writes an executable `romlift` into `dir` that runs the source CLI; returns its path, the value for ROMLIFT_CLI. */
export async function writeSourceCli(dir: string, options: SourceCliOptions = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const shim = path.join(dir, 'romlift');
  await writeFile(shim, sourceCliText(options));
  await chmod(shim, 0o755);
  return shim;
}

// ---------------------------------------------------------------------------------------------------
// A project that holds only its ROM.

export interface TempProject {
  readonly dir: string;
  /** The ROM's file name inside `dir`. */
  readonly romFile: string;
  /** The ROM's SHA-1 (lower-case hex). */
  readonly sha1: string;
  /** Removes `dir`. */
  remove(): Promise<void>;
}

export interface TempProjectOptions {
  /** The ROM's name in the project; default the source file's base name, or `baserom.gba` for bytes. */
  readonly romFile?: string;
  /** Where the project directory is made; default the system temporary directory. */
  readonly parent?: string;
  /** Default `romlift-e2e-`. */
  readonly prefix?: string;
}

export function sha1Hex(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

/** A fresh directory holding exactly one file, the ROM (a path to copy, or its bytes). */
export async function tempProject(rom: string | Uint8Array, options: TempProjectOptions = {}): Promise<TempProject> {
  const parent = options.parent ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, options.prefix ?? 'romlift-e2e-'));
  const romFile = options.romFile ?? (typeof rom === 'string' ? path.basename(rom) : 'baserom.gba');
  if (romFile === '' || romFile.includes('/') || romFile.startsWith('.')) throw new Error(`'${romFile}' is not a plain ROM file name`);
  const target = path.join(dir, romFile);
  if (typeof rom === 'string') await copyFile(rom, target);
  else await writeFile(target, rom);
  const sha1 = sha1Hex(new Uint8Array(await readFile(target)));
  return { dir, romFile, sha1, remove: () => rm(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------------------------------
// romlift --json.

/** One NDJSON line of romlift's --json output: a diagnostic, a check, the summary, or a command's own lines. */
export interface CliLine {
  readonly type: string;
  readonly code?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly ok?: boolean;
  readonly exitCode?: number;
  readonly sha1?: string;
}

export type NdjsonParse = { readonly ok: true; readonly lines: readonly CliLine[] } | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every non-empty line of `stdout` as a JSON object with a string `type`; the first bad line is named by number. */
export function parseNdjson(stdout: string): NdjsonParse {
  const lines: CliLine[] = [];
  const texts = stdout.split('\n');
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i] ?? '';
    if (text.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      return { ok: false, error: `line ${i + 1} is not JSON (${error instanceof Error ? error.message : String(error)}): ${text.slice(0, 200)}` };
    }
    if (!isRecord(value) || typeof value['type'] !== 'string') return { ok: false, error: `line ${i + 1} is not an object with a string type: ${text.slice(0, 200)}` };
    lines.push(value as unknown as CliLine);
  }
  return { ok: true, lines };
}

/** Why `lines` do not end with the summary of a run that exited `exitCode`, or undefined when they do. */
export function summaryProblem(lines: readonly CliLine[], exitCode: number): string | undefined {
  const last = lines[lines.length - 1];
  if (last === undefined) return 'no output line, so no summary';
  if (last.type !== 'summary') return `the last line is of type '${last.type}', not the summary`;
  if (last.exitCode !== exitCode) return `the summary says exitCode ${String(last.exitCode)}, the process exited ${exitCode}`;
  if (last.ok !== undefined && last.ok !== (exitCode === 0)) return `the summary says ok ${String(last.ok)} with exit ${exitCode}`;
  return undefined;
}

export interface RomliftRun {
  readonly result: CommandResult;
  /** Empty when the output is not NDJSON. */
  readonly lines: readonly CliLine[];
  readonly summary: CliLine | undefined;
  /** The codes of the diagnostic lines, in output order. */
  readonly codes: readonly string[];
  /** Why the output breaks the --json contract (bad NDJSON, no matching summary), or undefined. */
  readonly problem: string | undefined;
}

export interface RomliftOptions extends CommandOptions {
  readonly runner?: CommandRunner;
}

/** Runs `<cli> <args> --json` and checks its NDJSON and summary. */
export async function runRomlift(cli: string, args: readonly string[], options: RomliftOptions = {}): Promise<RomliftRun> {
  const { runner = runCommand, ...command } = options;
  const result = await runner(cli, [...args, '--json'], command);
  const parsed = parseNdjson(result.stdout);
  if (!parsed.ok) return { result, lines: [], summary: undefined, codes: [], problem: `romlift ${args.join(' ')} --json printed bad NDJSON: ${parsed.error}` };
  const problem = summaryProblem(parsed.lines, result.code);
  return {
    result,
    lines: parsed.lines,
    summary: parsed.lines.at(-1)?.type === 'summary' ? parsed.lines.at(-1) : undefined,
    codes: parsed.lines.filter((l) => l.type === 'diagnostic').map((l) => l.code ?? '?'),
    problem: problem === undefined ? undefined : `romlift ${args.join(' ')} --json: ${problem}`,
  };
}

// ---------------------------------------------------------------------------------------------------
// <name>.sha1.

export interface Sha1Record {
  readonly sha1: string;
  /** The file the record names: the ROM `make` builds. */
  readonly file: string;
}

const SHA1_LINE = /^([0-9a-f]{40}) [ *](\S.*?)\s*$/;

/** The first line of a sha1sum-format text (`<sha1>  <file>`, or `<sha1> *<file>`), or undefined. */
export function parseSha1Text(text: string): Sha1Record | undefined {
  const match = SHA1_LINE.exec(text.split('\n')[0] ?? '');
  return match?.[1] === undefined || match[2] === undefined ? undefined : { sha1: match[1], file: match[2] };
}

export type Sha1FileRead = ({ readonly ok: true; readonly path: string } & Sha1Record) | { readonly ok: false; readonly problem: string };

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The project's one `<name>.sha1` (the scaffold writes exactly one at its root). */
export async function readSha1File(dir: string): Promise<Sha1FileRead> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1')).sort(byCodeUnit);
  const name = names[0];
  if (names.length !== 1 || name === undefined) return { ok: false, problem: `${names.length} .sha1 files in the project, the scaffold writes one` };
  const record = parseSha1Text(await readFile(path.join(dir, name), 'utf8'));
  if (record === undefined) return { ok: false, problem: `${name} is not in sha1sum format` };
  return { ok: true, path: path.join(dir, name), ...record };
}

// ---------------------------------------------------------------------------------------------------
// File-tree snapshots.

export interface TreeEntry {
  readonly sha1: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** Project-relative path ('/'-separated) -> entry, in code-unit order of the paths. */
export type TreeSnapshot = ReadonlyMap<string, TreeEntry>;

export interface SnapshotOptions {
  /** Paths (and directories, with all below them) left out; default `.git` only. */
  readonly exclude?: readonly string[];
}

/** Every regular file under `dir` but the excluded ones, with its sha1, size and mtime. Symbolic links are not followed. */
export async function snapshotTree(dir: string, options: SnapshotOptions = {}): Promise<TreeSnapshot> {
  const exclude = new Set(options.exclude ?? ['.git']);
  const out: [string, TreeEntry][] = [];
  const walk = async (prefix: string): Promise<void> => {
    const entries = (await readdir(path.join(dir, prefix), { withFileTypes: true })).sort((a, b) => byCodeUnit(a.name, b.name));
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (exclude.has(relative)) continue;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) {
        const file = path.join(dir, relative);
        const info = await stat(file);
        out.push([relative, { sha1: sha1Hex(new Uint8Array(await readFile(file))), size: info.size, mtimeMs: info.mtimeMs }]);
      }
    }
  };
  await walk('');
  return new Map(out.sort((a, b) => byCodeUnit(a[0], b[0])));
}

export interface TreeDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Present in both with other bytes. */
  readonly changed: readonly string[];
  /** Present in both with the same bytes and another mtime: rewritten with what it held. */
  readonly touched: readonly string[];
}

/** How `after` differs from `before`; every list in code-unit order. */
export function diffTrees(before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const touched: string[] = [];
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(byCodeUnit);
  for (const key of keys) {
    const a = before.get(key);
    const b = after.get(key);
    if (a === undefined) added.push(key);
    else if (b === undefined) removed.push(key);
    else if (a.sha1 !== b.sha1) changed.push(key);
    else if (a.mtimeMs !== b.mtimeMs) touched.push(key);
  }
  return { added, removed, changed, touched };
}

/** No file added, removed or changed (a touched file keeps its bytes, so it counts as unchanged). */
export function sameBytes(diff: TreeDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

// ---------------------------------------------------------------------------------------------------
// The agbcc cache.

/** Where a project's agbcc lives, and what setup.sh's duty 2 looks for. */
export const AGBCC_DIR = 'tools/agbcc';
const AGBCC_BIN = 'bin/agbcc';
/** What pret/agbcc's install.sh installs, and all a build reads of tools/agbcc; the checkout and its objects stay behind. */
const AGBCC_INSTALLED = ['bin', 'include', 'lib'] as const;

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

export interface AgbccCache {
  /** The cache directory, holding bin/agbcc once filled. */
  readonly dir: string;
  /** Whether the cache holds an agbcc. */
  filled(): Promise<boolean>;
  /** Copies the cached agbcc into `<project>/tools/agbcc` when the cache holds one and the project has none; true when copied. */
  provide(projectDir: string): Promise<boolean>;
  /** Fills the cache from `<project>/tools/agbcc` when the cache is empty and the project built one; true when filled. */
  remember(projectDir: string): Promise<boolean>;
}

async function copyInstalled(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const part of AGBCC_INSTALLED) {
    const source = path.join(from, part);
    try {
      await stat(source);
    } catch {
      continue;
    }
    await cp(source, path.join(to, part), { recursive: true, preserveTimestamps: true });
  }
}

/** templates/agbcc.json of `repoRoot`, the pin every project's setup.sh builds agbcc at. */
export async function readAgbccPin(repoRoot: string = REPO_ROOT): Promise<AgbccPin> {
  const decoded = decodeAgbccPin(await readFile(path.join(repoRoot, 'templates', 'agbcc.json'), 'utf8'));
  if (!decoded.ok) throw new Error(`templates/agbcc.json: ${decoded.message}`);
  return decoded.value;
}

/**
 * Why a prebuilt agbcc may not be used under `pin`, or undefined: it records another pin (bench/src/scaffold.ts's
 * stamp, AGBCC_CACHE_PIN, as `bench run --scaffold`'s cache writes it). One without a stamp (the workflows' build at
 * the pinned commit, ROMLIFT_AGBCC) is taken as built at the pin.
 */
async function stalePrebuilt(prebuilt: string, pin: AgbccPin): Promise<string | undefined> {
  let stamp: string;
  try {
    stamp = await readFile(path.join(prebuilt, AGBCC_CACHE_PIN), 'utf8');
  } catch {
    return undefined;
  }
  return stamp === pinText(pin) ? undefined : `the prebuilt agbcc ${prebuilt} was built at ${stamp.trim()}, not at templates/agbcc.json's ${pinText(pin).trim()}`;
}

/**
 * A per-run cache of tools/agbcc in `dir`: the first project setup.sh builds agbcc in fills it (remember), and every
 * later project gets a copy before its setup.sh runs (provide), so one run builds agbcc once. `prebuilt`, a directory
 * holding bin/agbcc (and bin/old_agbcc), such as ROMLIFT_AGBCC, the workflows' build at the pinned commit or the
 * bench's cache, fills it from the start, unless it records another pin than `pin` (default templates/agbcc.json's).
 */
export async function agbccCache(dir: string, prebuilt?: string, pin?: AgbccPin): Promise<AgbccCache> {
  await mkdir(dir, { recursive: true });
  const filled = (): Promise<boolean> => isFile(path.join(dir, AGBCC_BIN));
  if (prebuilt !== undefined && !(await filled())) {
    if (!(await isFile(path.join(prebuilt, AGBCC_BIN)))) throw new Error(`no ${AGBCC_BIN} under the prebuilt agbcc ${prebuilt}`);
    const stale = await stalePrebuilt(prebuilt, pin ?? (await readAgbccPin()));
    if (stale !== undefined) throw new Error(stale);
    await copyInstalled(prebuilt, dir);
  }
  return {
    dir,
    filled,
    async provide(projectDir) {
      const target = path.join(projectDir, AGBCC_DIR);
      if (!(await filled()) || (await isFile(path.join(target, AGBCC_BIN)))) return false;
      await copyInstalled(dir, target);
      return true;
    },
    async remember(projectDir) {
      const source = path.join(projectDir, AGBCC_DIR);
      if ((await filled()) || !(await isFile(path.join(source, AGBCC_BIN)))) return false;
      await copyInstalled(source, dir);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// setup.sh and make, and the whole loop.

/** setup.sh may build agbcc (a few minutes); make assembles and links the tree. */
export const SETUP_TIMEOUT_MS = 30 * 60_000;
export const MAKE_TIMEOUT_MS = 15 * 60_000;
export const ROMLIFT_TIMEOUT_MS = 15 * 60_000;

export interface BuildOptions {
  /** ROMLIFT_CLI for setup.sh (and make): the romlift command it runs instead of `npx romlift`. */
  readonly cli: string;
  readonly runner?: CommandRunner;
  readonly agbcc?: AgbccCache;
  readonly setupTimeoutMs?: number;
  readonly makeTimeoutMs?: number;
  /** More environment for setup.sh and make. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface BuildOutcome {
  /** undefined when make ended at the SHA-1. */
  readonly failure: string | undefined;
  readonly setup: CommandResult | undefined;
  readonly make: CommandResult | undefined;
  /** What <name>.sha1 records. */
  readonly recorded: Sha1Record | undefined;
  /** The SHA-1 of the ROM make built, when it built one. */
  readonly built: string | undefined;
}

/**
 * `./setup.sh` then `make` in an initialised project, each under its time limit, with ROMLIFT_CLI set; the cached
 * agbcc is copied in first and the cache filled after. Ends at the SHA-1 when make exits 0 and the ROM <name>.sha1
 * names has the SHA-1 it records, which must be `expected` when given.
 */
export async function buildProject(dir: string, options: BuildOptions, expected?: string): Promise<BuildOutcome> {
  const runner = options.runner ?? runCommand;
  const env = { ...options.env, ROMLIFT_CLI: options.cli };
  const none = { setup: undefined, make: undefined, recorded: undefined, built: undefined };
  await options.agbcc?.provide(dir);
  const setup = await runner('./setup.sh', [], { cwd: dir, env, timeoutMs: options.setupTimeoutMs ?? SETUP_TIMEOUT_MS });
  await options.agbcc?.remember(dir);
  if (setup.code !== 0) return { ...none, setup, failure: `./setup.sh ${setup.timedOut ? 'timed out' : `exited ${setup.code}`}:\n${outputTail(setup)}` };
  const make = await runner('make', [], { cwd: dir, env, timeoutMs: options.makeTimeoutMs ?? MAKE_TIMEOUT_MS });
  if (make.code !== 0) return { ...none, setup, make, failure: `make ${make.timedOut ? 'timed out' : `exited ${make.code}`}:\n${outputTail(make)}` };
  const read = await readSha1File(dir);
  if (!read.ok) return { ...none, setup, make, failure: read.problem };
  const recorded = { sha1: read.sha1, file: read.file };
  if (expected !== undefined && read.sha1 !== expected) return { ...none, setup, make, recorded, failure: `${path.basename(read.path)} records ${read.sha1}, the ROM is ${expected}` };
  const romPath = path.join(dir, read.file);
  if (!(await isFile(romPath))) return { ...none, setup, make, recorded, failure: `make did not build ${read.file}` };
  const built = sha1Hex(new Uint8Array(await readFile(romPath)));
  const failure = built === read.sha1 ? undefined : `make built ${read.file} with SHA-1 ${built}, ${path.basename(read.path)} records ${read.sha1}`;
  return { setup, make, recorded, built, failure };
}

export interface EndToEndOptions extends BuildOptions {
  /** More `init` arguments (expect.json's init.args), before --json. */
  readonly initArgs?: readonly string[];
  readonly initTimeoutMs?: number;
}

export interface EndToEndOutcome {
  /** undefined when the project ended at the ROM's SHA-1 with romlift.toml as init wrote it. */
  readonly failure: string | undefined;
  readonly init: RomliftRun;
  readonly build: BuildOutcome | undefined;
  /** The tree after init (without tools/), and how setup.sh and make changed it (without build/, tools/ and .git). */
  readonly afterInit: TreeSnapshot | undefined;
  readonly diff: TreeDiff | undefined;
}

/** What a build may change in a project: everything it writes lives under these, and the built ROM. */
const BUILD_OUTPUTS = ['.git', 'build', 'tools'];

/**
 * The loop of a user's first build, in a project that holds only its ROM: `romlift init <rom> --json`, then
 * `./setup.sh` and `make` (buildProject), which must end at the ROM's SHA-1 and leave romlift.toml as init wrote it.
 */
export async function runEndToEnd(project: Pick<TempProject, 'dir' | 'romFile' | 'sha1'>, options: EndToEndOptions): Promise<EndToEndOutcome> {
  const runner = options.runner ?? runCommand;
  const init = await runRomlift(options.cli, ['init', project.romFile, ...(options.initArgs ?? [])], {
    cwd: project.dir,
    runner,
    timeoutMs: options.initTimeoutMs ?? ROMLIFT_TIMEOUT_MS,
  });
  const none = { build: undefined, afterInit: undefined, diff: undefined };
  if (init.problem !== undefined) return { ...none, init, failure: `${init.problem}\n${outputTail(init.result)}` };
  if (init.result.code !== 0) return { ...none, init, failure: `init exited ${init.result.code} with [${init.codes.join(', ')}]:\n${outputTail(init.result)}` };
  const afterInit = await snapshotTree(project.dir, { exclude: BUILD_OUTPUTS });
  const build = await buildProject(project.dir, options, project.sha1);
  const after = await snapshotTree(project.dir, { exclude: BUILD_OUTPUTS });
  const diff = diffTrees(afterInit, after);
  if (build.failure !== undefined) return { init, build, afterInit, diff, failure: build.failure };
  const toml = diff.changed.includes('romlift.toml') || diff.removed.includes('romlift.toml');
  return { init, build, afterInit, diff, failure: toml ? 'setup.sh or make changed romlift.toml' : undefined };
}

// ---------------------------------------------------------------------------------------------------
// The fixtures the end-to-end runs build.

/** Fixtures no end-to-end build runs, each with where it is proven instead (as g4.e2e-fixtures and g4.packed-e2e skip them). */
export const NOT_BUILT: Readonly<Record<string, string>> = { 'c-data': 'its C array must fail the link (g4.c-data-fails-loud)' };

/** `init`'s extra arguments from a fixture's expect.json (`{"init": {"args": [string]}}`), none when absent. */
export function initArgsOf(expectText: string, where: string): readonly string[] {
  const value: unknown = JSON.parse(expectText);
  if (!isRecord(value)) throw new Error(`${where}: not an object`);
  const init = value['init'];
  if (init === undefined) return [];
  if (!isRecord(init)) throw new Error(`${where}: init is not an object`);
  const args = init['args'];
  if (args === undefined) return [];
  if (!Array.isArray(args) || !args.every((a): a is string => typeof a === 'string')) throw new Error(`${where}: init.args is not an array of strings`);
  return args;
}

export interface EndToEndFixture {
  readonly fixture: SyntheticFixture;
  readonly initArgs: readonly string[];
}

/** The committed fixtures an end-to-end run builds (all but NOT_BUILT), with their init arguments, by name. */
export async function endToEndFixtures(fixtures: readonly SyntheticFixture[] = listSyntheticFixtures()): Promise<readonly EndToEndFixture[]> {
  const out: EndToEndFixture[] = [];
  for (const fixture of fixtures) {
    if (NOT_BUILT[fixture.name] !== undefined) continue;
    const initArgs = (await isFile(fixture.expect)) ? initArgsOf(await readFile(fixture.expect, 'utf8'), `${fixture.name}/expect.json`) : [];
    out.push({ fixture, initArgs });
  }
  return out;
}
