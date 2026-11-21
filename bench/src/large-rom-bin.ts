// The `romlift` bin's own commands on the 32 MiB synthetic ROM under the heap cap its launcher passes to Node (the
// owner's answer to Q6, D69: "every ROM size up to 32 MiB must complete under it", at 1,024 MiB since Q7's, D72;
// phase-3.md, fix round 4). g3.large-rom
// measures the bench's `init` and `generate` workflow children; a user runs the CLI, whose commands take their own
// paths (explain's bare-ROM analysis, update's two analyses), so this runs each of them, from source, with the Node
// options of src/cli/main.ts's first line (the `#!/usr/bin/env -S node ...` launcher dist/cli/main.js keeps):
//   node --conditions=source bench/src/large-rom.ts --bin [--json] [--rom <path>]
// Each run reports its exit code, its peak RSS and its peak live heap (bench/src/rss-probe.ts: the largest heap V8
// found used after a full mark-compact, what runs into the cap; neither when V8 aborted it), and for a --json command
// whether its last line is an ok summary. It runs the one-shot workflow as a user does: `init baserom.gba --json` in a
// project directory holding only the ROM as baserom.gba, then `generate --json` and `update --json` in the project init
// wrote (roadmap 4.E). The report, last on stdout:
//   {schema: 'romlift/bench-large-rom-bin@1', romBytes, sha1, nodeOptions, runs: [{command, exitCode, maxRssMiB,
//    peakLiveHeapMiB, summaryOk?, detail}]}
// The script exits 0 when every run completed (exit 0, and an ok summary for a --json command), else 1; nothing
// gates it: test/local/large-rom-bin.test.ts requires it.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASEROM_FILE } from 'romlift';
import { sha1Of } from 'romlift/node';

import { REPO_ROOT } from './context.ts';
import { type ProcessResult, runProcess } from './process.ts';

export const LARGE_ROM_BIN_SCHEMA = 'romlift/bench-large-rom-bin@1';
/** The CLI's entry point, whose first line is the bin's launcher. */
export const CLI_MAIN = join(REPO_ROOT, 'src', 'cli', 'main.ts');
const RSS_PROBE = fileURLToPath(new URL('./rss-probe.ts', import.meta.url));
const RSS_LINE = /^romlift-bench-rss (\d+)$/;
const LIVE_HEAP_LINE = /^romlift-bench-live-heap (\d+(?:\.\d+)?|-)$/;

/** One CLI command line to run; `{rom}` stands for the ROM's path. */
export interface BinRun {
  readonly command: string;
  readonly args: readonly string[];
  /** Its stdout ends in a {"type":"summary"} line. */
  readonly json: boolean;
  /**
   * It runs in the project directory, which starts holding only the ROM as baserom.gba (`init` writes the project
   * there, the later project runs read it); otherwise in the bench's own working directory.
   */
  readonly inProject?: boolean;
}

/**
 * Every command that reads a whole ROM: explain of a bare ROM in both output forms, then the one-shot workflow in a
 * project directory: init, generate over the project init wrote, and update.
 */
export const BIN_RUNS: readonly BinRun[] = [
  { command: 'explain', args: ['explain', '0x08000200', '--rom', '{rom}'], json: false },
  { command: 'explain --json', args: ['explain', '0x08000200', '--rom', '{rom}', '--json'], json: true },
  { command: 'init --json', args: ['init', BASEROM_FILE, '--json'], json: true, inProject: true },
  { command: 'generate --json', args: ['generate', '--json'], json: true, inProject: true },
  { command: 'update --json', args: ['update', '--json'], json: true, inProject: true },
];

export interface BinRunResult {
  readonly command: string;
  readonly exitCode: number;
  /** Peak RSS in MiB to a hundredth; null when the process wrote none (V8 aborted it). */
  readonly maxRssMiB: number | null;
  /** The largest heap live after a full mark-compact, in MiB to a hundredth; null when none ran or V8 aborted the process. */
  readonly peakLiveHeapMiB: number | null;
  readonly summaryOk?: boolean;
  readonly detail: string;
}

export interface LargeRomBinReport {
  readonly schema: typeof LARGE_ROM_BIN_SCHEMA;
  readonly romBytes: number;
  readonly sha1: string;
  /** The Node options of the launcher every run used. */
  readonly nodeOptions: readonly string[];
  readonly runs: readonly BinRunResult[];
}

/** The Node options of the bin's launcher: what follows `node` on the `#!/usr/bin/env -S node ...` first line. */
export function launcherOptions(mainText: string): readonly string[] {
  const first = mainText.split('\n', 1)[0] ?? '';
  const match = /^#!\/usr\/bin\/env -S node(?: (.*))?$/.exec(first);
  if (match === null) throw new Error(`src/cli/main.ts's first line is not the bin's launcher: ${first}`);
  return (match[1] ?? '').split(' ').filter((o) => o !== '');
}

/** What one finished process says: its RSS and live-heap lines, its last stdout line read as a summary, and why it failed. */
export function binRunOf(run: BinRun, result: ProcessResult): BinRunResult {
  const rssLine = result.stderr
    .trimEnd()
    .split('\n')
    .reverse()
    .find((l) => RSS_LINE.test(l));
  const rss =
    rssLine === undefined
      ? null
      : Math.round((Number.parseInt(RSS_LINE.exec(rssLine)?.[1] ?? '0', 10) / 1024) * 100) / 100;
  const liveLine = result.stderr
    .trimEnd()
    .split('\n')
    .reverse()
    .find((l) => LIVE_HEAP_LINE.test(l));
  const liveText = liveLine === undefined ? '-' : (LIVE_HEAP_LINE.exec(liveLine)?.[1] ?? '-');
  const live = liveText === '-' ? null : Number.parseFloat(liveText);
  const fatal = result.stderr.split('\n').find((l) => l.startsWith('FATAL ERROR:'));
  const base = { command: run.command, exitCode: result.code, maxRssMiB: rss, peakLiveHeapMiB: live };
  if (!run.json)
    return {
      ...base,
      detail: fatal ?? (result.code === 0 ? 'completed' : result.stderr.trimEnd().split('\n').slice(-3).join(' | ')),
    };
  let summary: { readonly type?: unknown; readonly ok?: unknown } = {};
  try {
    summary = JSON.parse(result.stdout.trimEnd().split('\n').at(-1) ?? '') as typeof summary;
  } catch {
    // no summary line: reported as summaryOk false
  }
  const summaryOk = summary.type === 'summary' && summary.ok === true;
  return { ...base, summaryOk, detail: fatal ?? (summaryOk ? 'ok summary' : 'no ok summary') };
}

/** Whether a run completed: exit 0, and an ok summary for a --json command. */
export function completed(run: BinRun, result: BinRunResult): boolean {
  return result.exitCode === 0 && (!run.json || result.summaryOk === true);
}

export interface LargeRomBinDeps {
  readonly image: () => Promise<Uint8Array>;
  /** Runs node with these arguments in `cwd` (undefined: the bench's own); default a child process. */
  readonly spawn: (args: readonly string[], cwd?: string) => Promise<ProcessResult>;
  readonly log: (line: string) => void;
}

/**
 * Runs every BIN_RUNS command on the image, one process each, one after the other; the project runs in `project/`,
 * which holds only the ROM as baserom.gba until `init` writes the project.
 */
export async function largeRomBin(deps: LargeRomBinDeps): Promise<LargeRomBinReport> {
  const bytes = await deps.image();
  const sha1 = sha1Of(bytes);
  const nodeOptions = launcherOptions(await readFile(CLI_MAIN, 'utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'romlift-large-rom-bin-'));
  try {
    const rom = join(dir, 'large-rom.gba');
    await writeFile(rom, bytes);
    const project = join(dir, 'project');
    await mkdir(project);
    await writeFile(join(project, BASEROM_FILE), bytes);
    deps.log(`ROM: ${bytes.length} bytes, SHA-1 ${sha1}; node ${nodeOptions.join(' ')}`);
    const runs: BinRunResult[] = [];
    for (const run of BIN_RUNS) {
      const args = run.args.map((a) => (a === '{rom}' ? rom : a));
      const result = binRunOf(
        run,
        await deps.spawn(
          ['--conditions=source', ...nodeOptions, '--import', RSS_PROBE, CLI_MAIN, ...args],
          run.inProject === true ? project : undefined,
        ),
      );
      deps.log(
        `${run.command.padEnd(40)} exit ${result.exitCode}, peak RSS ${result.maxRssMiB === null ? '-' : `${result.maxRssMiB.toFixed(1)} MiB`}, peak live heap ${result.peakLiveHeapMiB === null ? '-' : `${result.peakLiveHeapMiB.toFixed(1)} MiB`}: ${result.detail}`,
      );
      runs.push(result);
    }
    return { schema: LARGE_ROM_BIN_SCHEMA, romBytes: bytes.length, sha1, nodeOptions, runs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether every run completed (the script's exit code: 0, else 1). */
export function allCompleted(report: LargeRomBinReport): boolean {
  return BIN_RUNS.every((run) => {
    const result = report.runs.find((r) => r.command === run.command);
    return result !== undefined && completed(run, result);
  });
}

/** The default spawn: node itself. */
export function spawnNode(args: readonly string[], cwd?: string): Promise<ProcessResult> {
  return runProcess(process.execPath, args, cwd === undefined ? {} : { cwd });
}
