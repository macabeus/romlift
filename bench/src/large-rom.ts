// The large-ROM memory run of g3.large-rom (architecture §9.4, D42, D68 b, D69): a standalone script, run as
//   node --conditions=source bench/src/large-rom.ts [--json] [--rom <path>]
// (`npm run bench -- large-rom` spawns this file and never imports it). It builds the deterministic 32 MiB synthetic
// image (large-rom-image.ts), or reads the ROM `--rom` names (the tuning ROMs are measured that way, D68 b), writes it
// into a temporary directory, and runs each workflow in a child process of its own, under the heap cap the `romlift`
// bin passes (`--max-old-space-size=384`, src/cli/main.ts's first line, D69), so each peak resident set is that
// workflow's alone, measured as a user's run would be:
//   init       the discover analysis, configFromDiscover, generate, planWrites and applyWrites into an empty
//              directory; it also writes the config it built, which the next child reads;
//   generate   generate over that config (the confirm analysis, the model, the check pass), then planWrites and
//              applyWrites into another empty directory.
// A child (`--child init|generate --rom <path> --out <dir> [--config-out|--config <path>]`) prints one JSON line,
// {command, exitCode, maxRssKiB, maxOldSpaceSizeMiB, files, detail, treeDigest?}: maxRssKiB is
// process.resourceUsage().maxRSS at its end, maxOldSpaceSizeMiB the heap cap its own command line gave Node (null
// without one), the tree digest the sha256 over path NUL text NUL of every entry in stream order (written trees only), and
// its exit code that of `romlift verify` (0 written, 3 a failed check, 1 an error). The parent prints, last,
//   {schema: 'romlift/bench-large-rom@1', romBytes, sha1, runs: [{command, exitCode, maxRssMiB, maxOldSpaceSizeMiB,
//    treeDigest?}]}
// and exits 0 when both children reported, whatever they measured: the gate judges exit 0, the cap and maxRssMiB
// against LARGE_ROM_MAX_RSS_MIB.
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
/**
 * g3.large-rom's limit, for the human output only; the gate judges (test/gates/g3.large-rom.test.ts holds the same
 * number). The owner's answer to Q2 sets it from the runs under the heap cap with a stated margin (D68 b); no run of
 * the synthetic ROM completes under the cap, so it stays D42's 512 MiB until the owner answers Q6 (phase-3.md).
 */
export const LARGE_ROM_MAX_RSS_MIB = 512;
/**
 * The heap cap, in MiB of V8's old space, that the `romlift` bin passes to Node (`#!/usr/bin/env -S node
 * --max-old-space-size=384`, the first line of src/cli/main.ts) and every child of this script runs under (D68 b;
 * 384 MiB by the owner's answer to Q6, which replaces Q2's 256, D69).
 */
export const LARGE_ROM_MAX_OLD_SPACE_MIB = 384;
export const LARGE_ROM_COMMANDS = ['init', 'generate'] as const;
export type LargeRomCommand = (typeof LARGE_ROM_COMMANDS)[number];

/** This script, which the parent runs again as each child. */
export const LARGE_ROM_SCRIPT = fileURLToPath(import.meta.url);

/** What a child prints, its last stdout line. */
export interface ChildReport {
  readonly command: LargeRomCommand;
  readonly exitCode: number;
  readonly maxRssKiB: number;
  /** The `--max-old-space-size` of this child's own command line, or null when it ran without one. */
  readonly maxOldSpaceSizeMiB: number | null;
  readonly files: number;
  readonly detail: string;
  readonly treeDigest?: string;
}

export interface LargeRomRun {
  readonly command: LargeRomCommand;
  readonly exitCode: number;
  readonly maxRssMiB: number;
  /** The heap cap the child ran under (null: none, or no report). */
  readonly maxOldSpaceSizeMiB: number | null;
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

/** The `--max-old-space-size` of a Node command line (the last one wins, as in Node), or null. */
export function maxOldSpaceOf(execArgv: readonly string[]): number | null {
  let cap: number | null = null;
  for (const arg of execArgv) {
    const match = /^--max[-_]old[-_]space[-_]size=(\d+)$/.exec(arg);
    if (match?.[1] !== undefined) cap = Number.parseInt(match[1], 10);
  }
  return cap;
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
    maxOldSpaceSizeMiB: maxOldSpaceOf(process.execArgv),
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
    const output = `${result.stdout}${result.stderr}`.trimEnd().split('\n');
    // V8's out-of-memory report ends in a native stack; its FATAL ERROR line says why.
    const fatal = output.find((line) => line.startsWith('FATAL ERROR:'));
    const tail = fatal ?? output.slice(-5).join(' | ');
    return { command, exitCode: result.code === 0 ? 1 : result.code, maxRssMiB: 0, maxOldSpaceSizeMiB: null, detail: `no report: ${tail}` };
  }
  return {
    command,
    exitCode: report.exitCode,
    maxRssMiB: mib(report.maxRssKiB),
    maxOldSpaceSizeMiB: typeof report.maxOldSpaceSizeMiB === 'number' ? report.maxOldSpaceSizeMiB : null,
    ...(report.treeDigest === undefined ? {} : { treeDigest: report.treeDigest }),
    detail: report.detail,
  };
}

/** Node's options for each child: the sources, and the heap cap of the `romlift` bin. */
export const CHILD_NODE_ARGS: readonly string[] = ['--conditions=source', `--max-old-space-size=${LARGE_ROM_MAX_OLD_SPACE_MIB}`];

export interface LargeRomDeps {
  /** The image; default the 32 MiB synthetic ROM over the committed fixtures. */
  readonly image: () => Promise<Uint8Array>;
  /** Runs this script again with `args`; default a node child process under the heap cap. */
  readonly spawn: (args: readonly string[]) => Promise<ProcessResult>;
  readonly log: (line: string) => void;
}

export const DEFAULT_LARGE_ROM_DEPS: LargeRomDeps = {
  image: async () => largeRomImage((await readFixtureRoms(REPO_ROOT)).map((f) => f.bytes)),
  spawn: (args) => runProcess(process.execPath, [...CHILD_NODE_ARGS, LARGE_ROM_SCRIPT, ...args]),
  log: (line) => process.stderr.write(`${line}\n`),
};

/** The deps of a run over the ROM file at `path` instead of the synthetic image (the tuning ROMs, D68 b). */
export function romFileDeps(path: string, deps: LargeRomDeps = DEFAULT_LARGE_ROM_DEPS): LargeRomDeps {
  return { ...deps, image: async () => new Uint8Array(await readFile(path)) };
}

/** Builds the image, runs init then generate each in its own child, and reports both. */
export async function largeRom(deps: LargeRomDeps = DEFAULT_LARGE_ROM_DEPS): Promise<LargeRomReport> {
  const bytes = await deps.image();
  const sha1 = sha1Of(bytes);
  const dir = await mkdtemp(join(tmpdir(), 'romlift-large-rom-'));
  try {
    const rom = join(dir, 'large-rom.gba');
    const config = join(dir, 'config.json');
    await writeFile(rom, bytes);
    deps.log(`ROM: ${bytes.length} bytes, SHA-1 ${sha1}`);
    const runs: LargeRomRun[] = [];
    for (const command of LARGE_ROM_COMMANDS) {
      const out = join(dir, `${command}-tree`);
      const configArgs = command === 'init' ? ['--config-out', config] : ['--config', config];
      await mkdir(out, { recursive: true });
      const run = runOf(command, await deps.spawn(['--child', command, '--rom', rom, '--out', out, ...configArgs]));
      deps.log(`${command.padEnd(8)} exit ${run.exitCode}, peak RSS ${run.maxRssMiB.toFixed(1)} MiB, heap cap ${run.maxOldSpaceSizeMiB ?? 'none'}${run.treeDigest === undefined ? '' : `, tree ${run.treeDigest}`}: ${run.detail}`);
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
    (r) =>
      `${r.command.padEnd(8)} exit ${r.exitCode}  peak RSS ${r.maxRssMiB.toFixed(1)} MiB (${r.maxRssMiB < LARGE_ROM_MAX_RSS_MIB ? 'under' : 'AT OR OVER'} ${LARGE_ROM_MAX_RSS_MIB} MiB)  heap cap ${r.maxOldSpaceSizeMiB === null ? 'none' : `${r.maxOldSpaceSizeMiB} MiB`}${r.treeDigest === undefined ? '' : `  tree ${r.treeDigest}`}`,
  );
  return [`ROM ${report.sha1} (${report.romBytes} bytes)`, ...lines].join('\n');
}

/** The script: `--child ...` runs one workflow; otherwise the parent run (`--rom`: over that file), its report last on stdout. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes('--child')) {
      const report = await runChild(argv);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report.exitCode;
    }
    const args = parseArgs(argv, { flags: ['json'], options: ['rom'] });
    const rom = args.options['rom'];
    const report = await largeRom(rom === undefined ? DEFAULT_LARGE_ROM_DEPS : romFileDeps(rom));
    process.stdout.write(`${args.flags.has('json') ? JSON.stringify(report) : largeRomText(report)}\n`);
    return bothReported(report) ? 0 : 1;
  } catch (error) {
    process.stderr.write(`large-rom: ${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
