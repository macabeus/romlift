// The large-ROM memory run of g3.large-rom (architecture §9.4, D42): a standalone script, run as
//   node --conditions=source bench/src/large-rom.ts [--json]
// (`npm run bench -- large-rom` spawns this file and never imports it). It builds the deterministic 32 MiB synthetic
// image (large-rom-image.ts), writes it into a temporary directory, and runs each workflow in a child process of its
// own, so each peak resident set is that workflow's alone:
//   init       the discover analysis, configFromDiscover, generate, planWrites and applyWrites into an empty
//              directory; it also writes the config it built, which the next child reads;
//   generate   generate over that config (the confirm analysis, the model, the check pass), then planWrites and
//              applyWrites into another empty directory.
// A child (`--child init|generate --rom <path> --out <dir> [--config-out|--config <path>]`) prints one JSON line,
// {command, exitCode, maxRssKiB, files, detail, treeDigest?}: maxRssKiB is process.resourceUsage().maxRSS at its
// end, the tree digest the sha256 over path NUL text NUL of every entry in stream order (written trees only), and
// its exit code that of `romlift verify` (0 written, 3 a failed check, 1 an error). The parent prints, last,
//   {schema: 'romlift/bench-large-rom@1', romBytes, sha1, runs: [{command, exitCode, maxRssMiB, treeDigest?}]}
// and exits 0 when both children reported, whatever they measured: the gate judges maxRssMiB < 512 and exit 0.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateConfig, type FunctionConfig, type RomliftConfig, type SymbolConfig } from 'romlift';
import { readRom, sha1Of } from 'romlift/node';

import { parseArgs, UsageError } from './args.ts';
import { REPO_ROOT } from './context.ts';
import { ROMLIFT_EMISSION, type EmissionOutcome, type EmissionRunner } from './emission-run.ts';
import { largeRomImage, readFixtureRoms } from './large-rom-image.ts';
import { runProcess, type ProcessResult } from './process.ts';

export const LARGE_ROM_SCHEMA = 'romlift/bench-large-rom@1';
/** g3.large-rom's limit, for the human output only; the gate judges. */
export const LARGE_ROM_MAX_RSS_MIB = 512;
export const LARGE_ROM_COMMANDS = ['init', 'generate'] as const;
export type LargeRomCommand = (typeof LARGE_ROM_COMMANDS)[number];

/** This script, which the parent runs again as each child. */
export const LARGE_ROM_SCRIPT = fileURLToPath(import.meta.url);

/** What a child prints, its last stdout line. */
export interface ChildReport {
  readonly command: LargeRomCommand;
  readonly exitCode: number;
  readonly maxRssKiB: number;
  readonly files: number;
  readonly detail: string;
  readonly treeDigest?: string;
}

export interface LargeRomRun {
  readonly command: LargeRomCommand;
  readonly exitCode: number;
  readonly maxRssMiB: number;
  readonly treeDigest?: string;
  /** What the child said, or why it said nothing. */
  readonly detail: string;
}

/** The --json line (frozen by test/gates/g3.large-rom.test.ts). */
export interface LargeRomReport {
  readonly schema: typeof LARGE_ROM_SCHEMA;
  readonly romBytes: number;
  readonly sha1: string;
  readonly runs: readonly LargeRomRun[];
}

// ---------------------------------------------------------------------------------------------------
// The config the init child hands the generate child: RomliftConfig as JSON, its maps as [address, entry] pairs.

export function encodeConfig(config: RomliftConfig): string {
  return JSON.stringify({ ...config, functions: [...config.functions], symbols: [...config.symbols] });
}

export function decodeConfig(text: string): RomliftConfig {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const pairs = <T>(value: unknown): Map<number, T> => new Map(Array.isArray(value) ? (value as [number, T][]) : []);
  const checked = validateConfig({ ...raw, functions: pairs<FunctionConfig>(raw['functions']), symbols: pairs<SymbolConfig>(raw['symbols']) });
  if (!checked.ok) throw new Error(`the config is not schema 1: ${checked.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return checked.config;
}

// ---------------------------------------------------------------------------------------------------
// The child.

/** `romlift verify`'s exit code for an emission outcome: 0 written, 3 a failed check, 1 an error or a failed write. */
export function outcomeExitCode(outcome: EmissionOutcome): number {
  if (outcome.ok) return 0;
  return outcome.failure === 'check' ? 3 : 1;
}

/** One workflow in this process, as the child runs it; its report carries this process's peak resident set. */
export async function runChild(argv: readonly string[], runner: EmissionRunner = ROMLIFT_EMISSION): Promise<ChildReport> {
  const args = parseArgs(argv, { options: ['child', 'rom', 'out', 'config', 'config-out'] });
  const command = args.options['child'];
  const romPath = args.options['rom'];
  const out = args.options['out'];
  if (command !== 'init' && command !== 'generate') throw new UsageError('--child is init or generate');
  if (romPath === undefined || out === undefined) throw new UsageError('--child needs --rom <path> and --out <dir>');
  const read = await readRom(romPath);
  if (!read.ok) throw new Error(read.diagnostic.message);
  const rom = read.value;
  let outcome: EmissionOutcome;
  if (command === 'init') {
    const config = runner.prepare(rom);
    outcome = await runner.generate(rom, config, out);
    const configOut = args.options['config-out'];
    if (configOut !== undefined) await writeFile(configOut, encodeConfig(config));
  } else {
    const configPath = args.options['config'];
    const config = configPath === undefined ? runner.prepare(rom) : decodeConfig(await readFile(configPath, 'utf8'));
    outcome = await runner.generate(rom, config, out);
  }
  return {
    command,
    exitCode: outcomeExitCode(outcome),
    maxRssKiB: process.resourceUsage().maxRSS,
    files: outcome.files,
    detail: outcome.detail,
    ...(outcome.treeDigest === undefined ? {} : { treeDigest: outcome.treeDigest }),
  };
}

// ---------------------------------------------------------------------------------------------------
// The parent.

/** The last stdout line of a child, when it is a child report. */
export function parseChildReport(stdout: string): ChildReport | undefined {
  const last = stdout.trimEnd().split('\n').at(-1);
  if (last === undefined || last === '') return undefined;
  try {
    const value = JSON.parse(last) as Partial<ChildReport>;
    if ((value.command !== 'init' && value.command !== 'generate') || typeof value.exitCode !== 'number' || typeof value.maxRssKiB !== 'number') return undefined;
    return value as ChildReport;
  } catch {
    return undefined;
  }
}

/** KiB to MiB, to a hundredth. */
export function mib(kib: number): number {
  return Math.round((kib / 1024) * 100) / 100;
}

/** A child's run: from its report, or, when it printed none, its exit code and the end of its output. */
export function runOf(command: LargeRomCommand, result: ProcessResult): LargeRomRun {
  const report = parseChildReport(result.stdout);
  if (report === undefined) {
    const tail = `${result.stdout}${result.stderr}`.trimEnd().split('\n').slice(-5).join(' | ');
    return { command, exitCode: result.code === 0 ? 1 : result.code, maxRssMiB: 0, detail: `no report: ${tail}` };
  }
  return {
    command,
    exitCode: report.exitCode,
    maxRssMiB: mib(report.maxRssKiB),
    ...(report.treeDigest === undefined ? {} : { treeDigest: report.treeDigest }),
    detail: report.detail,
  };
}

export interface LargeRomDeps {
  /** The image; default the 32 MiB synthetic ROM over the committed fixtures. */
  readonly image: () => Promise<Uint8Array>;
  /** Runs this script again with `args`; default a node child process. */
  readonly spawn: (args: readonly string[]) => Promise<ProcessResult>;
  readonly log: (line: string) => void;
}

export const DEFAULT_LARGE_ROM_DEPS: LargeRomDeps = {
  image: async () => largeRomImage((await readFixtureRoms(REPO_ROOT)).map((f) => f.bytes)),
  spawn: (args) => runProcess(process.execPath, ['--conditions=source', LARGE_ROM_SCRIPT, ...args]),
  log: (line) => process.stderr.write(`${line}\n`),
};

/** Builds the image, runs init then generate each in its own child, and reports both. */
export async function largeRom(deps: LargeRomDeps = DEFAULT_LARGE_ROM_DEPS): Promise<LargeRomReport> {
  const bytes = await deps.image();
  const sha1 = sha1Of(bytes);
  const dir = await mkdtemp(join(tmpdir(), 'romlift-large-rom-'));
  try {
    const rom = join(dir, 'large-rom.gba');
    const config = join(dir, 'config.json');
    await writeFile(rom, bytes);
    deps.log(`large ROM: ${bytes.length} bytes, SHA-1 ${sha1}`);
    const runs: LargeRomRun[] = [];
    for (const command of LARGE_ROM_COMMANDS) {
      const out = join(dir, `${command}-tree`);
      const configArgs = command === 'init' ? ['--config-out', config] : ['--config', config];
      await mkdir(out, { recursive: true });
      const run = runOf(command, await deps.spawn(['--child', command, '--rom', rom, '--out', out, ...configArgs]));
      deps.log(`${command.padEnd(8)} exit ${run.exitCode}, peak RSS ${run.maxRssMiB.toFixed(1)} MiB${run.treeDigest === undefined ? '' : `, tree ${run.treeDigest}`}: ${run.detail}`);
      runs.push(run);
      await rm(out, { recursive: true, force: true });
    }
    return { schema: LARGE_ROM_SCHEMA, romBytes: bytes.length, sha1, runs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether both children reported (the exit code of the parent: 0, else 1). */
export function bothReported(report: LargeRomReport): boolean {
  return LARGE_ROM_COMMANDS.every((c) => report.runs.some((r) => r.command === c && !r.detail.startsWith('no report')));
}

/** The human lines of a report. */
export function largeRomText(report: LargeRomReport): string {
  const lines = report.runs.map(
    (r) => `${r.command.padEnd(8)} exit ${r.exitCode}  peak RSS ${r.maxRssMiB.toFixed(1)} MiB (${r.maxRssMiB < LARGE_ROM_MAX_RSS_MIB ? 'under' : 'AT OR OVER'} ${LARGE_ROM_MAX_RSS_MIB} MiB)${r.treeDigest === undefined ? '' : `  tree ${r.treeDigest}`}`,
  );
  return [`large ROM ${report.sha1} (${report.romBytes} bytes)`, ...lines].join('\n');
}

/** The script: `--child ...` runs one workflow; otherwise the parent run, its report last on stdout. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes('--child')) {
      const report = await runChild(argv);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report.exitCode;
    }
    const args = parseArgs(argv, { flags: ['json'] });
    const report = await largeRom();
    process.stdout.write(`${args.flags.has('json') ? JSON.stringify(report) : largeRomText(report)}\n`);
    return bothReported(report) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`large-rom: ${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
