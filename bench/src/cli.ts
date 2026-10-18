// `npm run bench -- <command>` (architecture §8.5). Each command prints human-readable lines; with
// --json the last stdout line is the command's JSON verdict. Exit 0 on success, 1 on a failed check or
// a refused input, 2 on a usage error. The analysis is reached through BenchDeps.runner (romlift's own
// by default), so the tests run every command on hand-built analyses.
import { fileURLToPath } from 'node:url';

import { isRuleId, type RuleId } from 'romlift';

import { ablate, isAblatable } from './ablate.ts';
import { benchAdopt } from './adopt.ts';
import { benchProfile, ROMLIFT_RUNNER, type AnalysisRunner, type RunTuning } from './analysis-run.ts';
import { parseArgs, UsageError, type ArgSpec, type BenchArgs } from './args.ts';
import { readResultsFile } from './artifact.ts';
import { contextFromEnv, gatesDir, resultsPath, type BenchContext } from './context.ts';
import { datasetCheck } from './dataset-check.ts';
import { doctorReal } from './doctor-real.ts';
import { benchExplain, explainText, parseExplainAddr } from './explain.ts';
import { BenchError, prettyJson } from './files.ts';
import { runGates, type Tier } from './gates.ts';
import { gitHead } from './git.ts';
import { pocCheck, romPasses } from './poc-check.ts';
import { provenanceChecks, provenanceInputs } from './provenance.ts';
import { defaultBase, readBase, readFresh, regression, regressionReport } from './regression.ts';
import { baselineText, diffResults, formatDiff, moved } from './report.ts';
import { BENCH_RUN_SCHEMA, benchRun, largeRomProcess, revealDataset, summaryText, type BenchRunReport, type RunOptions } from './run.ts';
import type { EmissionFamilies } from './scaffold.ts';
import { serve } from './serve.ts';
import { benchSpeed, speedPasses } from './speed.ts';

export interface BenchIo {
  out(line: string): void;
  err(line: string): void;
}

/**
 * What the commands reach outside the repository: the analysis, the clock of a reveal, the calibration
 * workload, and from phase 3 the emission families, the large-ROM script and objdiff-cli (run.ts's defaults
 * when absent).
 */
export interface BenchDeps {
  readonly runner: AnalysisRunner;
  readonly now: () => string;
  /** The speed calibration workload; the default is speed.ts's. */
  readonly calibrate?: () => unknown;
  readonly emission?: EmissionFamilies;
  readonly largeRom?: RunOptions['largeRom'];
  readonly objdiffTool?: RunOptions['objdiffTool'];
  /** How `bench large-rom` runs the script; default run.ts largeRomProcess. */
  readonly largeRomProcess?: typeof largeRomProcess;
}

export const DEFAULT_DEPS: BenchDeps = { runner: ROMLIFT_RUNNER, now: () => new Date().toISOString() };

interface Command {
  readonly summary: string;
  readonly args: ArgSpec;
  /** Options that may repeat (`--disable a --disable b`); their values arrive in `repeated`. */
  readonly repeated?: readonly string[];
  /** The arguments go unparsed to another program, in `raw`. */
  readonly passthrough?: boolean;
  run(cx: BenchContext, args: BenchArgs, io: BenchIo, deps: BenchDeps, repeated: Readonly<Record<string, readonly string[]>>, raw: readonly string[]): Promise<number>;
}

const json = (io: BenchIo, value: unknown): void => io.out(JSON.stringify(value));

function integer(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text)) throw new UsageError(`--${name} must be a non-negative integer`);
  return Number.parseInt(text, 10);
}

/** Takes every `--<name> <value>` of the repeatable options out of argv; values may also be comma-separated. */
export function takeRepeated(argv: readonly string[], names: readonly string[]): { readonly rest: string[]; readonly values: Record<string, string[]> } {
  const rest: string[] = [];
  const values: Record<string, string[]> = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    const list = values[name];
    if (list === undefined) {
      rest.push(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    list.push(...value.split(',').filter((v) => v !== ''));
    i++;
  }
  return { rest, values };
}

/** The tuning of `--disable`. */
function runTuning(disabled: readonly string[]): RunTuning {
  const rules: RuleId[] = [];
  for (const id of disabled) {
    if (!isRuleId(id)) throw new UsageError(`--disable ${id} is not a rule id`);
    rules.push(id);
  }
  return { disabled: rules };
}

function printRunReport(io: BenchIo, report: BenchRunReport, asJson: boolean): void {
  for (const f of report.failed) io.err(`${f.name}: ${f.detail}`);
  if (asJson) json(io, report);
}

export const COMMANDS: Readonly<Record<string, Command>> = {
  run: {
    summary:
      'run [--only <rom>] [--json] [--scaffold] [--write-readability-floor] [--disable <rule>...] [--cpu-prof] [--reveal <rom> --reason <text>]  ' +
      "score romlift's discover run of every dataset and its readability; --scaffold builds and links both printers' trees and runs objdiff; " +
      'write bench/results.json (lead only, without --json) and bench/timings.json',
    args: { options: ['only', 'reveal', 'reason'], flags: ['json', 'cpu-prof', 'scaffold', 'write-readability-floor'] },
    repeated: ['disable'],
    async run(cx, args, io, deps, repeated) {
      const asJson = args.flags.has('json');
      const tuning = runTuning(repeated['disable'] ?? []);
      const reveal = args.options['reveal'];
      const reason = args.options['reason'];
      if (reason !== undefined && reveal === undefined) throw new UsageError('--reason goes with --reveal <rom>');
      if (reveal !== undefined) {
        if (reason === undefined || reason.trim() === '') throw new UsageError('--reveal needs --reason <text>');
        if (args.options['only'] !== undefined) throw new UsageError('--reveal names its dataset; drop --only');
        if (args.flags.has('scaffold') || args.flags.has('write-readability-floor')) throw new UsageError('--reveal scores one dataset; drop --scaffold and --write-readability-floor');
        const row = await revealDataset(cx, reveal, { reason, runner: deps.runner, at: deps.now(), log: io.out });
        io.out(summaryText(row));
        if (asJson) json(io, { schema: BENCH_RUN_SCHEMA, roms: [row], sealed: [], failed: [] } satisfies BenchRunReport);
        else io.out(prettyJson(row).trimEnd());
        return 0;
      }
      const only = args.options['only'];
      const outcome = await benchRun(cx, {
        ...(only === undefined ? {} : { only }),
        json: asJson,
        tuning,
        cpuProf: args.flags.has('cpu-prof'),
        scaffold: args.flags.has('scaffold'),
        writeReadabilityFloor: args.flags.has('write-readability-floor'),
        runner: deps.runner,
        ...(deps.emission === undefined ? {} : { emission: deps.emission }),
        ...(deps.largeRom === undefined ? {} : { largeRom: deps.largeRom }),
        ...(deps.objdiffTool === undefined ? {} : { objdiffTool: deps.objdiffTool }),
        log: io.out,
      });
      printRunReport(io, outcome.report, asJson);
      const r = outcome.results;
      if (r !== undefined) {
        io.out(
          `wrote bench/results.json (${r.roms.length} rows, ${r.sealed?.length ?? 0} sealed, commit ${r.meta.commit ?? 'none'}${r.meta.dirty ? ', dirty' : ''}; gate record ${outcome.gatesKept ? 'kept' : 'cleared'})`,
        );
      }
      return outcome.report.failed.length === 0 ? 0 : 1;
    },
  },
  'large-rom': {
    summary: 'large-rom [--json] [...]  run bench/src/large-rom.ts with these arguments (the memory family, g3.large-rom) and relay its output and exit code',
    args: {},
    passthrough: true,
    async run(cx, _args, io, deps, _repeated, raw) {
      const run = await (deps.largeRomProcess ?? largeRomProcess)(cx, raw);
      for (const line of run.stdout.split('\n').filter((l, i, all) => l !== '' || i < all.length - 1)) io.out(line);
      return run.code;
    },
  },
  speed: {
    summary: 'speed [--only <rom>] [--json] [--write-baseline]  serial median CPU time of the analysis per tuning ROM against bench/baseline/speed.json, calibrated',
    args: { options: ['only'], flags: ['json', 'write-baseline'] },
    async run(cx, args, io, deps) {
      const only = args.options['only'];
      const write = args.flags.has('write-baseline');
      const report = await benchSpeed(cx, {
        ...(only === undefined ? {} : { only }),
        runner: deps.runner,
        log: io.out,
        writeBaseline: write,
        ...(deps.calibrate === undefined ? {} : { calibrate: deps.calibrate }),
      });
      if (args.flags.has('json')) json(io, report);
      return write || speedPasses(report) ? 0 : 1;
    },
  },
  ablate: {
    summary: 'ablate <rule> [--only <name>] [--tier synthetic|real] [--json]  re-run with one rule disabled and print where it was decisive and what moves',
    args: { options: ['only', 'tier'], flags: ['json'], maxPositionals: 1 },
    async run(cx, args, io, deps) {
      const rule = args.positionals[0];
      if (rule === undefined) throw new UsageError('ablate needs a rule id');
      if (!isAblatable(rule, benchProfile())) throw new UsageError(`${rule} is neither a registered rule nor in the profile's pipeline`);
      const tier = args.options['tier'] ?? 'synthetic';
      if (tier !== 'synthetic' && tier !== 'real') throw new UsageError('--tier must be synthetic or real');
      const only = args.options['only'];
      const report = await ablate(cx, rule, { tier, ...(only === undefined ? {} : { only }), runner: deps.runner, log: io.out });
      io.out(`${rule}: decisive in ${report.decisiveIn.length}, changes ${report.changed.length} ${tier} target(s)`);
      if (args.flags.has('json')) json(io, report);
      return 0;
    },
  },
  explain: {
    summary: 'explain <rom> <addr> [--json]  what the discover run decided about one address of a tuning ROM or a fixture',
    args: { flags: ['json'], maxPositionals: 2 },
    async run(cx, args, io, deps) {
      const [rom, text] = args.positionals;
      if (rom === undefined || text === undefined) throw new UsageError('explain needs a ROM name and an address');
      const addr = parseExplainAddr(text);
      if (addr === undefined) throw new UsageError(`${text} is not an address (0x... or decimal)`);
      const report = await benchExplain(cx, rom, addr, deps.runner);
      for (const line of explainText(report)) io.out(line);
      if (args.flags.has('json')) json(io, report);
      return 0;
    },
  },
  adopt: {
    summary: "adopt <rom>  seed a new tuning dataset's labels and untyped lists from its run, as unreviewed rows (refuses a sealed dataset)",
    args: { maxPositionals: 1 },
    async run(cx, args, io, deps) {
      const rom = args.positionals[0];
      if (rom === undefined) throw new UsageError('adopt needs a dataset name');
      const outcome = await benchAdopt(cx, rom, deps.runner, (await gitHead(cx.repoRoot)) ?? 'none');
      io.out(`${outcome.file}: ${outcome.added.length} row(s) added as unreviewed; classify each (bench explain) and commit with these trailers:`);
      for (const t of outcome.trailers) io.out(t);
      return 0;
    },
  },
  'poc-check': {
    summary: 'poc-check [--json]  rescoring the PoC dumps reproduces bench/baseline/poc-2026-10-16.json (g1.bench-harness)',
    args: { flags: ['json'] },
    async run(cx, args, io) {
      const report = await pocCheck(cx);
      for (const r of report.roms) {
        io.out(`${r.name.padEnd(12)} ${romPasses(r) ? 'OK' : 'FAILED'}  rows ${r.rowsEqual ? 'equal' : 'differ'}, PoC row ${r.pinnedRow === true ? (r.pocRowEqual ? 'equal to the one pinned in poc-dump-rows.json (rows compared with the PoC\'s own row)' : 'differs from the pinned one') : !r.baselineRow ? 'missing (no baseline row, not revealed)' : r.pocRowEqual ? 'equal' : 'differs'}, scaffold ${r.scaffoldOk ? 'OK' : 'FAILED'}, ${r.deterministic ? 'deterministic' : 'NOT deterministic'}, PoC source ${r.pocSourceDigestOk ? 'pinned' : 'NOT pinned'}`);
        for (const d of r.diffs) io.out(`  ${d}`);
      }
      if (args.flags.has('json')) json(io, report);
      return report.ok ? 0 : 1;
    },
  },
  'dataset-check': {
    summary: "dataset-check [--json]  every labels row is an ELF FUNC inside a function romlift's run found, every untyped row is not a FUNC, no stale row (g1.dataset-elf)",
    args: { flags: ['json'] },
    async run(cx, args, io, deps) {
      const report = await datasetCheck(cx, deps.runner);
      for (const p of report.problems) io.out(`${p.dataset}: ${p.problem}: ${p.detail}`);
      if (report.ok) io.out('every dataset agrees with its ELF and its run');
      if (args.flags.has('json')) json(io, { ok: report.ok, problems: report.problems.map((p) => ({ dataset: p.dataset, list: p.list, addr: p.addr, problem: p.problem })) });
      return report.ok ? 0 : 1;
    },
  },
  provenance: {
    summary: 'provenance [--json]  the artifact matches the sources, its gate record, families and dataset rows (architecture §8.6)',
    args: { flags: ['json'] },
    async run(cx, args, io) {
      const checks = provenanceChecks(await provenanceInputs(cx));
      for (const c of checks) io.out(`${c.id.padEnd(14)} ${c.ok ? 'ok' : 'FAILED'}  ${c.detail}`);
      const ok = checks.every((c) => c.ok);
      if (args.flags.has('json')) json(io, { ok, checks });
      return ok ? 0 : 1;
    },
  },
  'stale-check': {
    summary: "stale-check  fails when the source digest differs from the artifact's",
    args: {},
    async run(cx, _args, io) {
      const inputs = await provenanceInputs(cx);
      const [digest] = provenanceChecks(inputs);
      if (digest === undefined) return 1;
      io.out(digest.ok ? `the artifact is current: ${digest.detail}` : digest.detail);
      return digest.ok ? 0 : 1;
    },
  },
  'doctor-real': {
    summary: 'doctor-real [--json]  every ROM, ELF, map, the PoC checkout and the toolchain match their recorded digests',
    args: { flags: ['json'] },
    async run(cx, args, io) {
      const report = await doctorReal(cx);
      for (const c of report.checks) io.out(`${c.id.padEnd(22)} ${c.ok ? 'ok' : 'FAILED'}  ${c.detail}`);
      if (args.flags.has('json')) json(io, report);
      return report.ok ? 0 : 1;
    },
  },
  gates: {
    summary: 'gates [--require <n>] [--tier ci|real] [--dir <dir>]  run the gate tests and print every verdict; --tier real writes the gate record',
    args: { options: ['require', 'tier', 'dir'] },
    async run(cx, args, io) {
      const tierText = args.options['tier'] ?? 'ci';
      if (tierText !== 'ci' && tierText !== 'real') throw new UsageError('--tier must be ci or real');
      const tier: Tier = tierText;
      const require = integer(args.options['require'], 'require');
      const outcome = await runGates(cx, {
        tier,
        ...(require === undefined ? {} : { require }),
        dir: args.options['dir'] ?? gatesDir(cx),
        resultsPath: resultsPath(cx),
        log: io.out,
      });
      if (outcome.records.length === 0) io.out('no gate records');
      for (const f of outcome.failures) io.err(`gate failure: ${f}`);
      if (outcome.failures.some((f) => f.includes('left no record'))) io.err(outcome.runnerOutput);
      return outcome.failures.length === 0 ? 0 : 1;
    },
  },
  regression: {
    summary: 'regression [--base <ref|file>] [--fresh <file>] [--json]  compare with the base artifact (default: git merge-base origin/main HEAD)',
    args: { options: ['base', 'fresh'], flags: ['json'] },
    async run(cx, args, io) {
      const base = args.options['base'];
      const fresh = args.options['fresh'];
      const outcome = await regression(cx, { ...(base === undefined ? {} : { base }), ...(fresh === undefined ? {} : { fresh }) });
      for (const n of outcome.notes) io.out(`note: ${n}`);
      if (outcome.failures.length > 0) {
        io.out(`REGRESSION against ${outcome.baseLabel}: ${outcome.failures.length} failure(s)`);
        for (const f of outcome.failures) io.out(`  ${f}`);
      } else {
        io.out(`no regression against ${outcome.baseLabel}`);
      }
      if (args.flags.has('json')) json(io, regressionReport(outcome));
      return outcome.failures.length === 0 ? 0 : 1;
    },
  },
  diff: {
    summary: 'diff [--base <ref|file>] [--fresh <file>]  the rows that moved, newly missed and newly false first',
    args: { options: ['base', 'fresh'] },
    async run(cx, args, io) {
      const ref = args.options['base'] ?? (await defaultBase(cx));
      const fresh = await readFresh(cx, args.options['fresh']);
      const { artifact } = await readBase(cx, ref);
      if (artifact === undefined) {
        io.out(`the base ${ref} has no bench/results.json`);
        return 0;
      }
      const diffs = diffResults(fresh, artifact);
      for (const d of diffs) io.out(formatDiff(d));
      if (!diffs.some(moved)) io.out(`no row moved against ${ref}`);
      return 0;
    },
  },
  baseline: {
    summary: 'baseline <rom> [--base <ref|file>]  what the committed artifact (default HEAD) says about one ROM',
    args: { options: ['base'], maxPositionals: 1 },
    async run(cx, args, io) {
      const rom = args.positionals[0];
      if (rom === undefined) throw new UsageError('baseline needs a ROM name');
      const ref = args.options['base'] ?? 'HEAD';
      const { artifact } = ref === 'file' ? { artifact: await readResultsFile(resultsPath(cx)) } : await readBase(cx, ref);
      const text = artifact === undefined ? undefined : baselineText(artifact, rom, ref);
      if (text === undefined) {
        io.err(`no row for ${rom} in the artifact at ${ref}`);
        return 1;
      }
      io.out(text);
      return 0;
    },
  },
  web: {
    summary: 'web [--port 4173] [--base <ref|file>]  serve the report',
    args: { options: ['port', 'base'] },
    async run(cx, args, io) {
      serve(cx, integer(args.options['port'], 'port') ?? 4173, args.options['base'], io.out);
      return await new Promise<number>(() => {});
    },
  },
};

export function usage(): string {
  return ['romlift benchmark: npm run bench -- <command>', '', ...Object.values(COMMANDS).map((c) => `  ${c.summary}`)].join('\n');
}

export async function main(argv: readonly string[], cx: BenchContext, io: BenchIo, deps: BenchDeps = DEFAULT_DEPS): Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined || !Object.hasOwn(COMMANDS, name) ? undefined : COMMANDS[name];
  if (command === undefined) {
    io.err(name === undefined ? usage() : `unknown command ${name}\n${usage()}`);
    return 2;
  }
  try {
    if (command.passthrough === true) return await command.run(cx, parseArgs([], command.args), io, deps, {}, rest);
    const { rest: remaining, values } = takeRepeated(rest, command.repeated ?? []);
    return await command.run(cx, parseArgs(remaining, command.args), io, deps, values, rest);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n${usage()}`);
      return 2;
    }
    if (error instanceof BenchError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const io: BenchIo = { out: (line) => process.stdout.write(`${line}\n`), err: (line) => process.stderr.write(`${line}\n`) };
  main(process.argv.slice(2), contextFromEnv(process.env), io).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 70;
    },
  );
}
