// The gate framework (architecture §10, D29, D50). Every `test/gates/gN.<name>.test.ts` calls `gate()`
// once; `gate()` registers one node:test test named by the gate id and decides its verdict:
//
//   historical   a PoC-parity gate once phase.json.landed >= historicalAfter
//   pending      a name in `needs` is exported by none of romlift, romlift/node, romlift/isa, romlift/internal
//   unavailable  a declared local input (`inputs`, plus `realInputs` on the real tier) is missing or its
//                digest differs from the recorded one
//   pass / fail  otherwise, whether `run` returned or threw
//
// Each recorded verdict is appended as one NDJSON line to $ROMLIFT_GATE_REPORT; `bench gates` parses
// those lines, so their shape is frozen. The pure decisions are exported for test/unit/gates.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type GateTier = 'ci' | 'real';
export type GateInput = 'roms' | 'elfs' | 'objects' | 'poc' | 'toolchain' | 'klonoa';
export type Verdict = 'pass' | 'fail' | 'pending' | 'unavailable' | 'historical';
export type GatePhase = 1 | 2 | 3 | 4 | 5 | 6;

export interface GateSpec {
  readonly id: `g${GatePhase}.${string}`;
  readonly phase: GatePhase;
  /** `both` for the gates architecture §13 marks "ci and real". */
  readonly tier: GateTier | 'both';
  /** Public exports the gate calls; any one missing makes the gate `pending`. */
  readonly needs: readonly string[];
  readonly inputs?: readonly GateInput[];
  /**
   * Inputs checked only when the selected tier is `real`: a `both` gate runs on the committed fixtures
   * in the ci tier and adds the local ROMs in the real tier, so its ci verdict must not need them.
   */
  readonly realInputs?: readonly GateInput[];
  /** PoC-parity gates: frozen as `historical` once this phase has landed. */
  readonly historicalAfter?: 2;
  /** Throws on failure. */
  run(cx: GateContext): Promise<void>;
}

export interface DatasetRef {
  readonly name: string;
  readonly rom: string;
  readonly elf: string;
  readonly map?: string;
  readonly sha1: string;
  readonly elfSha256?: string;
  readonly objectsDir?: string;
  readonly objectsDigest?: string;
  readonly family?: string;
  readonly heldout: boolean;
  readonly revealed: readonly unknown[];
}

/**
 * A committed synthetic fixture: `bench/dataset/synthetic/<name>/` holding `build/<name>.gba` (§8.1). Every
 * path is absolute; `elf` and `expect` are where §8.1 puts them, and a gate that reads them checks they exist.
 */
export interface FixtureRef {
  readonly name: string;
  readonly dir: string;
  readonly rom: string;
  readonly elf: string;
  readonly expect: string;
}

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface NpmOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface GateContext {
  readonly tier: GateTier;
  readonly repoRoot: string;
  readonly benchRoot: string;
  readonly pocRoot: string;
  readonly landed: number;
  /** Tuning datasets: `heldout` false, or revealed (non-empty `revealed`). */
  readonly datasets: readonly DatasetRef[];
  /** Sealed held-out datasets: `heldout` true and `revealed` empty. */
  readonly sealed: readonly DatasetRef[];
  /** The committed synthetic fixtures, by name. */
  readonly fixtures: readonly FixtureRef[];
  /** The export `name` of the first entry point that has it. */
  need<T>(name: string): T;
  /** Runs a process with stdin closed; never throws for a nonzero exit (127 when it cannot start, 124 on timeout). */
  exec(command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>;
  /** `npm run --silent <script> -- <args>` in repoRoot with ROMLIFT_BENCH_ROOT and ROMLIFT_POC set. */
  npm(script: string, args?: readonly string[], options?: NpmOptions): Promise<ExecResult>;
  /** Parses the last non-empty line of a command's output as JSON. */
  lastJson<T>(stdout: string): T;
  /** Parses every non-empty line of a command's NDJSON output. */
  jsonLines<T>(stdout: string): readonly T[];
  /** A fresh temporary directory, removed when the gate finishes. */
  tmpDir(prefix: string): Promise<string>;
  note(text: string): void;
  /** Records the digest of an input the gate read, for the report line. */
  digest(input: string, value: string): void;
}

/** One line of $ROMLIFT_GATE_REPORT. */
export interface GateRecord {
  readonly id: string;
  readonly phase: GatePhase;
  readonly tier: GateTier;
  readonly verdict: Verdict;
  readonly detail: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly missing: readonly string[];
  readonly ms: number;
}

/** The entry points whose exports satisfy `needs`, in lookup order, with their source files. */
export const ENTRY_POINTS = ['romlift', 'romlift/node', 'romlift/isa', 'romlift/internal'] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];
const ENTRY_SOURCES: Readonly<Record<EntryPoint, string>> = {
  romlift: 'src/index.ts',
  'romlift/node': 'src/node.ts',
  'romlift/isa': 'src/isa.ts',
  'romlift/internal': 'src/internal.ts',
};

// ---------------------------------------------------------------------------------------------------
// Pure decisions.

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The tier selected by ROMLIFT_GATE_TIER; `ci` when unset. */
export function selectedTier(env: Readonly<Record<string, string | undefined>>): GateTier {
  const value = env['ROMLIFT_GATE_TIER'];
  if (value === undefined || value === '' || value === 'ci') return 'ci';
  if (value === 'real') return 'real';
  throw new Error(`ROMLIFT_GATE_TIER must be 'ci' or 'real', got '${value}'`);
}

export function tierIncludes(tier: GateSpec['tier'], selected: GateTier): boolean {
  return tier === 'both' || tier === selected;
}

/** The benchmark root and PoC checkout, from the environment or their defaults (AGENTS.md). */
export function resolveRoots(
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
): { readonly benchRoot: string; readonly pocRoot: string } {
  const bench = env['ROMLIFT_BENCH_ROOT'];
  const benchRoot = bench ? path.resolve(repoRoot, bench) : path.dirname(repoRoot);
  const poc = env['ROMLIFT_POC'];
  const pocRoot = poc ? path.resolve(repoRoot, poc) : path.join(benchRoot, 'romlift-poc');
  return { benchRoot, pocRoot };
}

/** The inputs checked on `tier`: `inputs`, then `realInputs` on the real tier, each once, in that order. */
export function inputsFor(spec: Pick<GateSpec, 'inputs' | 'realInputs'>, tier: GateTier): readonly GateInput[] {
  const all = [...(spec.inputs ?? []), ...(tier === 'real' ? (spec.realInputs ?? []) : [])];
  return all.filter((input, index) => all.indexOf(input) === index);
}

/** The names of `needs` that no entry point exports, in `needs` order. */
export function missingExports(needs: readonly string[], exported: ReadonlySet<string>): readonly string[] {
  return needs.filter((name) => !exported.has(name));
}

/** Whether one declared input is present and matches its recorded digest. */
export interface InputCheck {
  readonly available: boolean;
  /** Why it is unavailable (empty when available). */
  readonly detail: string;
  /** The digest that identifies what was checked, when available. */
  readonly digest?: string;
}

export type Precondition =
  | { readonly verdict: 'historical'; readonly detail: string }
  | { readonly verdict: 'pending'; readonly detail: string; readonly missing: readonly string[] }
  | { readonly verdict: 'unavailable'; readonly detail: string; readonly missing: readonly string[] };

type DecisionSpec = Pick<GateSpec, 'needs' | 'inputs' | 'historicalAfter'>;

/** `historical` once the phase named by `historicalAfter` has landed. */
export function decideHistorical(spec: DecisionSpec, landed: number): Precondition | undefined {
  if (spec.historicalAfter !== undefined && landed >= spec.historicalAfter) {
    return { verdict: 'historical', detail: `frozen since phase ${spec.historicalAfter} landed` };
  }
  return undefined;
}

/** `pending` while a name in `needs` is exported by no entry point. */
export function decidePending(spec: DecisionSpec, exported: ReadonlySet<string>): Precondition | undefined {
  const missing = missingExports(spec.needs, exported);
  if (missing.length > 0) return { verdict: 'pending', detail: `not exported yet: ${missing.join(', ')}`, missing };
  return undefined;
}

/** `unavailable` when a declared input failed its check; the checks are given for declared inputs. */
export function decideInputs(
  spec: DecisionSpec,
  checks: Readonly<Partial<Record<GateInput, InputCheck>>>,
): Precondition | undefined {
  const missing: string[] = [];
  const details: string[] = [];
  for (const input of spec.inputs ?? []) {
    const check = checks[input];
    if (check === undefined) {
      missing.push(input);
      details.push(`${input}: not checked`);
    } else if (!check.available) {
      missing.push(input);
      details.push(`${input}: ${check.detail}`);
    }
  }
  if (missing.length > 0) return { verdict: 'unavailable', detail: details.join('; '), missing };
  return undefined;
}

/** The whole precondition: `historical`, `pending`, `unavailable` in that order, or undefined to run. */
export function decideVerdict(
  spec: DecisionSpec,
  facts: {
    readonly landed: number;
    readonly exported: ReadonlySet<string>;
    readonly checks: Readonly<Partial<Record<GateInput, InputCheck>>>;
  },
): Precondition | undefined {
  return decideHistorical(spec, facts.landed) ?? decidePending(spec, facts.exported) ?? decideInputs(spec, facts.checks);
}

/** How a verdict shows in node:test: passed, skipped with `<verdict>: <detail>`, or failed. */
export function testOutcome(
  verdict: Verdict,
  detail: string,
): { readonly kind: 'pass' } | { readonly kind: 'skip'; readonly message: string } | { readonly kind: 'fail' } {
  if (verdict === 'pass' || verdict === 'historical') return { kind: 'pass' };
  if (verdict === 'pending' || verdict === 'unavailable') return { kind: 'skip', message: `${verdict}: ${detail}` };
  return { kind: 'fail' };
}

/** One NDJSON report line, with a fixed key order and inputs sorted by code unit; no timestamps. */
export function formatRecord(record: GateRecord): string {
  const inputs: Record<string, string> = {};
  for (const key of Object.keys(record.inputs).sort(byCodeUnit)) inputs[key] = record.inputs[key] ?? '';
  return `${JSON.stringify({
    id: record.id,
    phase: record.phase,
    tier: record.tier,
    verdict: record.verdict,
    detail: record.detail,
    inputs,
    missing: [...record.missing],
    ms: Math.round(record.ms),
  })}\n`;
}

/** Parses the last non-empty line of `stdout` as JSON. */
export function lastJson<T>(stdout: string): T {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error('expected a JSON line on stdout, got none');
  return JSON.parse(last) as T;
}

/** Parses every non-empty line of `stdout` as JSON; a bad line is named by its 1-based number. */
export function jsonLines<T>(stdout: string): readonly T[] {
  const out: T[] = [];
  const lines = stdout.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(`line ${i + 1} is not JSON (${error instanceof Error ? error.message : String(error)}): ${line.slice(0, 200)}`);
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the fields of `bench/dataset/real/<rom>.json` the gates use; throws on a malformed file. */
export function parseDataset(value: unknown, file: string): DatasetRef {
  if (!isRecord(value)) throw new Error(`${file}: a dataset is a JSON object`);
  const text = (key: string, optional: boolean): string | undefined => {
    const field = value[key];
    if (field === undefined && optional) return undefined;
    if (typeof field !== 'string' || field === '') throw new Error(`${file}: '${key}' must be a non-empty string`);
    return field;
  };
  const heldout = value['heldout'];
  if (typeof heldout !== 'boolean') throw new Error(`${file}: 'heldout' must be a boolean`);
  const revealed = value['revealed'] ?? [];
  if (!Array.isArray(revealed)) throw new Error(`${file}: 'revealed' must be an array`);
  const optional: Record<string, string> = {};
  for (const key of ['map', 'elfSha256', 'objectsDir', 'objectsDigest', 'family'] as const) {
    const field = text(key, true);
    if (field !== undefined) optional[key] = field;
  }
  return {
    name: text('name', false) ?? '',
    rom: text('rom', false) ?? '',
    elf: text('elf', false) ?? '',
    sha1: text('sha1', false) ?? '',
    ...optional,
    heldout,
    revealed: [...(revealed as unknown[])],
  };
}

/** Tuning datasets (not held out, or revealed) and sealed ones (held out and never revealed). */
export function splitDatasets(all: readonly DatasetRef[]): {
  readonly tuning: readonly DatasetRef[];
  readonly sealed: readonly DatasetRef[];
} {
  const isSealed = (d: DatasetRef): boolean => d.heldout && d.revealed.length === 0;
  return { tuning: all.filter((d) => !isSealed(d)), sealed: all.filter(isSealed) };
}

// ---------------------------------------------------------------------------------------------------
// Input checks over an injected I/O, so the decisions are testable with fakes.

export interface Hasher {
  update(chunk: string | Uint8Array): void;
  digest(): string;
}

export interface GateIo {
  exists(file: string): Promise<boolean>;
  isDirectory(file: string): Promise<boolean>;
  /** Hex digest of a file's bytes; the real implementation computes each one once per process. */
  fileDigest(file: string, algorithm: 'sha1' | 'sha256'): Promise<string>;
  /** Every file under `dir`, as `/`-separated relative paths. */
  listFiles(dir: string): Promise<readonly string[]>;
  readBytes(file: string): Promise<Uint8Array>;
  readText(file: string): Promise<string>;
  realpath(file: string): Promise<string>;
  hash(algorithm: 'sha256'): Hasher;
  exec(command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>;
}

export interface InputEnv {
  readonly repoRoot: string;
  readonly benchRoot: string;
  readonly pocRoot: string;
  readonly tuning: readonly DatasetRef[];
  readonly sealed: readonly DatasetRef[];
}

/** The committed fixtures under `<repoRoot>/bench/dataset/synthetic`, sorted by name. */
export async function listFixtures(repoRoot: string, io: GateIo): Promise<readonly FixtureRef[]> {
  const root = path.join(repoRoot, 'bench', 'dataset', 'synthetic');
  if (!(await io.isDirectory(root))) return [];
  const out: FixtureRef[] = [];
  for (const file of await io.listFiles(root)) {
    const parts = file.split('/');
    const name = parts[0] ?? '';
    if (parts.length !== 3 || parts[1] !== 'build' || parts[2] !== `${name}.gba`) continue;
    const dir = path.join(root, name);
    out.push({ name, dir, rom: path.join(dir, 'build', `${name}.gba`), elf: path.join(dir, 'build', `${name}.elf`), expect: path.join(dir, 'expect.json') });
  }
  return out.sort((a, b) => byCodeUnit(a.name, b.name));
}

export const TOOLCHAIN_TOOLS: readonly string[] = ['arm-none-eabi-as', 'arm-none-eabi-ld', 'arm-none-eabi-objcopy'];

function summaryDigest(io: GateIo, lines: readonly string[]): string {
  const hasher = io.hash('sha256');
  for (const line of lines) hasher.update(`${line}\n`);
  return hasher.digest();
}

function result(io: GateIo, problems: readonly string[], digestLines: readonly string[]): InputCheck {
  if (problems.length > 0) return { available: false, detail: problems.join('; ') };
  return { available: true, detail: '', digest: summaryDigest(io, digestLines) };
}

/** sha256 over every `*.o` under `dir`: sorted relative path, NUL, bytes, for each file. */
export async function objectsDigest(dir: string, io: GateIo): Promise<string> {
  const files = (await io.listFiles(dir)).filter((file) => file.endsWith('.o')).sort(byCodeUnit);
  const hasher = io.hash('sha256');
  for (const file of files) {
    hasher.update(file);
    hasher.update('\0');
    hasher.update(await io.readBytes(path.join(dir, file)));
  }
  return hasher.digest();
}

export async function checkInput(input: GateInput, env: InputEnv, io: GateIo): Promise<InputCheck> {
  const all = [...env.tuning, ...env.sealed];
  const problems: string[] = [];
  const lines: string[] = [];
  switch (input) {
    case 'roms': {
      if (env.tuning.length === 0) return { available: false, detail: 'no tuning datasets' };
      for (const d of all) {
        const file = path.resolve(env.benchRoot, d.rom);
        if (!(await io.exists(file))) {
          problems.push(`${d.name}: ${d.rom} is missing`);
          continue;
        }
        const sha1 = await io.fileDigest(file, 'sha1');
        if (sha1 !== d.sha1) problems.push(`${d.name}: ${d.rom} has sha1 ${sha1}, the dataset records ${d.sha1}`);
        lines.push(`${d.name}\0${sha1}`);
      }
      return result(io, problems, lines);
    }
    case 'elfs': {
      if (env.tuning.length === 0) return { available: false, detail: 'no tuning datasets' };
      for (const d of all) {
        if (d.elfSha256 === undefined) {
          problems.push(`${d.name}: the dataset records no elfSha256`);
          continue;
        }
        const file = path.resolve(env.benchRoot, d.elf);
        if (!(await io.exists(file))) {
          problems.push(`${d.name}: ${d.elf} is missing`);
          continue;
        }
        const sha256 = await io.fileDigest(file, 'sha256');
        if (sha256 !== d.elfSha256) problems.push(`${d.name}: ${d.elf} has sha256 ${sha256}, the dataset records ${d.elfSha256}`);
        lines.push(`${d.name}\0${sha256}`);
      }
      return result(io, problems, lines);
    }
    case 'objects': {
      const withObjects = all.filter((d) => d.objectsDir !== undefined);
      if (withObjects.length === 0) return { available: false, detail: 'no dataset records objectsDir' };
      for (const d of withObjects) {
        const dir = path.resolve(env.benchRoot, d.objectsDir ?? '');
        if (d.objectsDigest === undefined) {
          problems.push(`${d.name}: the dataset records no objectsDigest`);
        } else if (!(await io.isDirectory(dir))) {
          problems.push(`${d.name}: ${d.objectsDir ?? ''} is missing`);
        } else {
          const digest = await objectsDigest(dir, io);
          if (digest !== d.objectsDigest) problems.push(`${d.name}: objects digest ${digest}, the dataset records ${d.objectsDigest}`);
          lines.push(`${d.name}\0${digest}`);
        }
      }
      return result(io, problems, lines);
    }
    case 'poc': {
      if (!(await io.isDirectory(env.pocRoot))) return { available: false, detail: `${env.pocRoot} is missing` };
      const pinned = path.join(env.repoRoot, 'bench', 'baseline', 'poc-source.json');
      if (!(await io.exists(pinned))) return { available: false, detail: 'bench/baseline/poc-source.json is missing' };
      const parsed: unknown = JSON.parse(await io.readText(pinned));
      const files = isRecord(parsed) ? parsed['files'] : undefined;
      if (!isRecord(files)) return { available: false, detail: 'bench/baseline/poc-source.json has no files map' };
      for (const relative of Object.keys(files).sort(byCodeUnit)) {
        const expected = files[relative];
        const file = path.resolve(env.pocRoot, relative);
        if (!(await io.exists(file))) {
          problems.push(`${relative} is missing`);
          continue;
        }
        const actual = await io.fileDigest(file, 'sha256');
        if (actual !== expected) problems.push(`${relative} differs from the pinned PoC source`);
      }
      if (problems.length > 0) return { available: false, detail: problems.join('; ') };
      const recorded = isRecord(parsed) && typeof parsed['digest'] === 'string' ? parsed['digest'] : undefined;
      return { available: true, detail: '', digest: recorded ?? summaryDigest(io, Object.keys(files).sort(byCodeUnit)) };
    }
    case 'toolchain': {
      for (const tool of TOOLCHAIN_TOOLS) {
        const run = await io.exec(tool, ['--version']);
        if (run.code !== 0) problems.push(`${tool} --version exited ${run.code}`);
        else lines.push((run.stdout.split('\n')[0] ?? '').trim());
      }
      return result(io, problems, lines);
    }
    case 'klonoa': {
      const dir = path.join(env.benchRoot, 'klonoa-empire-of-dreams');
      if (!(await io.isDirectory(dir))) return { available: false, detail: `${dir} is missing` };
      const top = await io.exec('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
      if (top.code !== 0 || (await io.realpath(top.stdout.trim())) !== (await io.realpath(dir))) {
        return { available: false, detail: `${dir} is not a git checkout` };
      }
      const head = await io.exec('git', ['-C', dir, 'rev-parse', 'HEAD']);
      if (head.code !== 0) return { available: false, detail: `${dir} has no HEAD commit` };
      return { available: true, detail: '', digest: head.stdout.trim() };
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// The real I/O.

export function exec(command: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, ...options.env };
    // A gate that runs `bench gates` must not append its nested records to the parent's report.
    if (options.env?.['ROMLIFT_GATE_REPORT'] === undefined) delete env['ROMLIFT_GATE_REPORT'];
    // node:test marks its child processes with NODE_TEST_CONTEXT; a nested `node --test` that inherits it
    // runs as a subtest stream, prints nothing and exits 0, so a gate that runs tests would pass vacuously.
    if (options.env?.['NODE_TEST_CONTEXT'] === undefined) delete env['NODE_TEST_CONTEXT'];
    const child = spawn(command, [...args], { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, options.timeoutMs);
    const finish = (code: number, extra: string): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') + extra,
      });
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => finish(127, `${error.message}\n`));
    child.on('close', (code, signal) => {
      if (timedOut) finish(124, `timed out after ${options.timeoutMs ?? 0} ms\n`);
      else finish(code ?? 128, signal ? `killed by ${signal}\n` : '');
    });
  });
}

export interface LockOptions {
  /** The directory holding the lock directories; default `<tmpdir>/romlift-gate-locks`. */
  readonly dir?: string;
  readonly pollMs?: number;
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

/** A lock whose owner process is gone, or one that never got an owner within ten seconds. */
async function lockIsStale(lock: string): Promise<boolean> {
  let owner: string;
  try {
    owner = await readFile(path.join(lock, 'owner'), 'utf8');
  } catch {
    try {
      return Date.now() - (await stat(lock)).mtimeMs > 10_000;
    } catch {
      return false;
    }
  }
  const pid = Number.parseInt(owner, 10);
  return !(Number.isInteger(pid) && pid > 0 && processAlive(pid));
}

/**
 * Runs `fn` while holding a lock shared by every process of this checkout, so gates that node:test runs
 * in parallel processes do not rebuild one shared input (the corpus) at the same time. The lock is a
 * directory created atomically; one whose owner process has exited is taken over.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const root = options.dir ?? path.join(tmpdir(), 'romlift-gate-locks');
  await mkdir(root, { recursive: true });
  const lock = path.join(root, createHash('sha256').update(`${REPO_ROOT}\0${name}`).digest('hex').slice(0, 24));
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    if (await lockIsStale(lock)) await rm(lock, { recursive: true, force: true });
    else await delay(options.pollMs ?? 200);
  }
  try {
    await writeFile(path.join(lock, 'owner'), `${process.pid}\n`);
    return await fn();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

const digestCache = new Map<string, Promise<string>>();

async function walk(dir: string, prefix: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative, out);
    else if (entry.isFile()) out.push(relative);
  }
}

export const nodeIo: GateIo = {
  async exists(file) {
    try {
      await stat(file);
      return true;
    } catch {
      return false;
    }
  },
  async isDirectory(file) {
    try {
      return (await stat(file)).isDirectory();
    } catch {
      return false;
    }
  },
  fileDigest(file, algorithm) {
    const key = `${algorithm}\0${file}`;
    let cached = digestCache.get(key);
    if (!cached) {
      cached = readFile(file).then((bytes) => createHash(algorithm).update(bytes).digest('hex'));
      digestCache.set(key, cached);
    }
    return cached;
  },
  async listFiles(dir) {
    const out: string[] = [];
    await walk(dir, '', out);
    return out.sort(byCodeUnit);
  },
  async readBytes(file) {
    return new Uint8Array(await readFile(file));
  },
  readText(file) {
    return readFile(file, 'utf8');
  },
  async realpath(file) {
    try {
      return await realpath(file);
    } catch {
      return file;
    }
  },
  hash(algorithm) {
    const hasher = createHash(algorithm);
    return {
      update(chunk) {
        hasher.update(chunk);
      },
      digest() {
        return hasher.digest('hex');
      },
    };
  },
  exec,
};

// ---------------------------------------------------------------------------------------------------
// The process-wide environment, computed once.

interface Environment {
  readonly repoRoot: string;
  readonly benchRoot: string;
  readonly pocRoot: string;
  readonly landed: number;
  readonly tuning: readonly DatasetRef[];
  readonly sealed: readonly DatasetRef[];
  readonly fixtures: readonly FixtureRef[];
}

interface Exports {
  readonly names: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, unknown>;
  /** Set when an entry point exists but fails to load. */
  readonly error?: string;
}

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

let environment: Promise<Environment> | undefined;
let exportsLoaded: Promise<Exports> | undefined;
const inputChecks = new Map<GateInput, Promise<InputCheck>>();

async function loadEnvironment(): Promise<Environment> {
  const { benchRoot, pocRoot } = resolveRoots(process.env, REPO_ROOT);
  const phase: unknown = JSON.parse(await readFile(path.join(REPO_ROOT, 'test', 'gates', 'phase.json'), 'utf8'));
  const landed = isRecord(phase) && typeof phase['landed'] === 'number' ? phase['landed'] : Number.NaN;
  if (!Number.isInteger(landed)) throw new Error('test/gates/phase.json must hold {"landed": <integer>}');
  const datasetDir = path.join(REPO_ROOT, 'bench', 'dataset', 'real');
  const names = (await nodeIo.isDirectory(datasetDir))
    ? (await readdir(datasetDir)).filter((name) => name.endsWith('.json')).sort(byCodeUnit)
    : [];
  const all: DatasetRef[] = [];
  for (const name of names) {
    const file = `bench/dataset/real/${name}`;
    all.push(parseDataset(JSON.parse(await readFile(path.join(REPO_ROOT, file), 'utf8')), file));
  }
  const { tuning, sealed } = splitDatasets(all);
  const fixtures = await listFixtures(REPO_ROOT, nodeIo);
  return { repoRoot: REPO_ROOT, benchRoot, pocRoot, landed, tuning, sealed, fixtures };
}

async function importEntry(name: EntryPoint): Promise<Record<string, unknown>> {
  const namespace: Record<string, unknown> = await import(name);
  return namespace;
}

async function loadExports(): Promise<Exports> {
  const names = new Set<string>();
  const values = new Map<string, unknown>();
  for (const entry of ENTRY_POINTS) {
    if (!(await nodeIo.exists(path.join(REPO_ROOT, ENTRY_SOURCES[entry])))) continue;
    let namespace: Record<string, unknown>;
    try {
      namespace = await importEntry(entry);
    } catch (error) {
      return { names, values, error: `cannot load ${entry}: ${error instanceof Error ? error.message : String(error)}` };
    }
    for (const key of Object.keys(namespace).sort(byCodeUnit)) {
      names.add(key);
      if (!values.has(key)) values.set(key, namespace[key]);
    }
  }
  return { names, values };
}

function checkOnce(input: GateInput, env: Environment): Promise<InputCheck> {
  let cached = inputChecks.get(input);
  if (!cached) {
    cached = checkInput(input, env, nodeIo);
    inputChecks.set(input, cached);
  }
  return cached;
}

function report(record: GateRecord): void {
  const file = process.env['ROMLIFT_GATE_REPORT'];
  if (file) appendFileSync(file, formatRecord(record));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------------------
// gate()

export function gate(spec: GateSpec): void {
  const selected = selectedTier(process.env);
  if (!tierIncludes(spec.tier, selected)) {
    test(spec.id, { skip: `tier ${spec.tier}; selected tier ${selected}` }, () => {});
    return;
  }
  test(spec.id, async (t: TestContext) => {
    const started = performance.now();
    const inputs: Record<string, string> = {};
    const notes: string[] = [];
    const record = (verdict: Verdict, detail: string, missing: readonly string[]): Verdict => {
      report({ id: spec.id, phase: spec.phase, tier: selected, verdict, detail, inputs, missing, ms: performance.now() - started });
      return verdict;
    };

    let precondition: Precondition | undefined;
    let env: Environment;
    let exported: Exports;
    try {
      environment ??= loadEnvironment();
      env = await environment;
      precondition = decideHistorical(spec, env.landed);
      if (precondition === undefined) {
        exportsLoaded ??= loadExports();
        exported = await exportsLoaded;
        if (exported.error !== undefined && spec.needs.length > 0) throw new Error(exported.error);
        precondition = decidePending(spec, exported.names);
      } else {
        exported = { names: new Set(), values: new Map() };
      }
      if (precondition === undefined) {
        const declared = inputsFor(spec, selected);
        const checks: Partial<Record<GateInput, InputCheck>> = {};
        for (const input of declared) {
          const check = await checkOnce(input, env);
          checks[input] = check;
          if (check.digest !== undefined) inputs[input] = check.digest;
        }
        precondition = decideInputs({ ...spec, inputs: declared }, checks);
      }
    } catch (error) {
      record('fail', message(error), []);
      throw error;
    }

    if (precondition !== undefined) {
      const missing = precondition.verdict === 'historical' ? [] : precondition.missing;
      const outcome = testOutcome(record(precondition.verdict, precondition.detail, missing), precondition.detail);
      if (outcome.kind === 'skip') t.skip(outcome.message);
      return;
    }

    const temporary: string[] = [];
    const cx: GateContext = {
      tier: selected,
      repoRoot: env.repoRoot,
      benchRoot: env.benchRoot,
      pocRoot: env.pocRoot,
      landed: env.landed,
      datasets: env.tuning,
      sealed: env.sealed,
      fixtures: env.fixtures,
      need<T>(name: string): T {
        if (!exported.values.has(name)) throw new Error(`'${name}' is not exported by any entry point`);
        return exported.values.get(name) as T;
      },
      exec,
      npm(script, args = [], options = {}) {
        const npmEnv: Record<string, string> = { ROMLIFT_BENCH_ROOT: env.benchRoot, ROMLIFT_POC: env.pocRoot, ...options.env };
        const execOptions: ExecOptions =
          options.timeoutMs === undefined ? { cwd: env.repoRoot, env: npmEnv } : { cwd: env.repoRoot, env: npmEnv, timeoutMs: options.timeoutMs };
        return exec('npm', ['run', '--silent', script, '--', ...args], execOptions);
      },
      lastJson,
      jsonLines,
      async tmpDir(prefix) {
        const dir = await mkdtemp(path.join(tmpdir(), prefix));
        temporary.push(dir);
        return dir;
      },
      note(text) {
        notes.push(text);
        t.diagnostic(text);
      },
      digest(input, value) {
        inputs[input] = value;
      },
    };
    try {
      await spec.run(cx);
    } catch (error) {
      record('fail', message(error), []);
      throw error;
    } finally {
      for (const dir of temporary) await rm(dir, { recursive: true, force: true });
    }
    record('pass', notes.join('; '), []);
  });
}
