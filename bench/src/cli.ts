// `npm run bench -- <command>` (architecture §8.5): the phase-1 commands. Each prints human-readable
// lines; with --json the last stdout line is the command's JSON verdict. Exit 0 on success, 1 on a
// failed check or a refused input, 2 on a usage error.
import { fileURLToPath } from 'node:url';

import { parseArgs, UsageError, type ArgSpec, type BenchArgs } from './args.ts';
import { readResultsFile } from './artifact.ts';
import { contextFromEnv, gatesDir, resultsPath, type BenchContext } from './context.ts';
import { datasetCheck } from './dataset-check.ts';
import { doctorReal } from './doctor-real.ts';
import { BenchError } from './files.ts';
import { runGates, type Tier } from './gates.ts';
import { pocCheck, romPasses } from './poc-check.ts';
import { provenanceChecks, provenanceInputs } from './provenance.ts';
import { readBase, readFresh, regression, defaultBase } from './regression.ts';
import { baselineText, diffResults, formatDiff, moved } from './report.ts';
import { benchRun } from './run.ts';
import { serve } from './serve.ts';

export interface BenchIo {
  out(line: string): void;
  err(line: string): void;
}

interface Command {
  readonly summary: string;
  readonly args: ArgSpec;
  run(cx: BenchContext, args: BenchArgs, io: BenchIo): Promise<number>;
}

const json = (io: BenchIo, value: unknown): void => io.out(JSON.stringify(value));

function integer(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined;
  if (!/^\d+$/.test(text)) throw new UsageError(`--${name} must be a non-negative integer`);
  return Number.parseInt(text, 10);
}

export const COMMANDS: Readonly<Record<string, Command>> = {
  run: {
    summary: 'run [--only <rom>]  score every tuning dataset from the PoC dumps; write bench/results.json and bench/timings.json',
    args: { options: ['only'] },
    async run(cx, args, io) {
      const only = args.options['only'];
      const { results, gatesKept } = await benchRun(cx, { ...(only === undefined ? {} : { only }), log: io.out });
      io.out(`wrote bench/results.json (${results.roms.length} rows, commit ${results.meta.commit ?? 'none'}${results.meta.dirty ? ', dirty' : ''}; gate record ${gatesKept ? 'kept' : 'cleared'})`);
      return 0;
    },
  },
  'poc-check': {
    summary: 'poc-check [--json]  rescoring the PoC dumps reproduces bench/baseline/poc-2026-10-16.json (g1.bench-harness)',
    args: { flags: ['json'] },
    async run(cx, args, io) {
      const report = await pocCheck(cx);
      for (const r of report.roms) {
        io.out(`${r.name.padEnd(12)} ${romPasses(r) ? 'OK' : 'FAILED'}  rows ${r.rowsEqual ? 'equal' : 'differ'}, PoC row ${r.pocRowEqual ? 'equal' : 'differs'}, scaffold ${r.scaffoldOk ? 'OK' : 'FAILED'}, ${r.deterministic ? 'deterministic' : 'NOT deterministic'}, PoC source ${r.pocSourceDigestOk ? 'pinned' : 'NOT pinned'}`);
        for (const d of r.diffs) io.out(`  ${d}`);
      }
      if (args.flags.has('json')) json(io, report);
      return report.ok ? 0 : 1;
    },
  },
  'dataset-check': {
    summary: 'dataset-check [--json]  every labels row is an ELF FUNC inside a found function, every untyped row is not a FUNC, no stale row (g1.dataset-elf)',
    args: { flags: ['json'] },
    async run(cx, args, io) {
      const report = await datasetCheck(cx);
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
    summary: 'stale-check  fails when the source digest differs from the artifact\'s',
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
    summary: 'regression [--base <ref|file>] [--fresh <file>]  compare with the base artifact (default: git merge-base origin/main HEAD)',
    args: { options: ['base', 'fresh'] },
    async run(cx, args, io) {
      const base = args.options['base'];
      const fresh = args.options['fresh'];
      const outcome = await regression(cx, { ...(base === undefined ? {} : { base }), ...(fresh === undefined ? {} : { fresh }) });
      for (const n of outcome.notes) io.out(`note: ${n}`);
      if (outcome.failures.length > 0) {
        io.out(`REGRESSION against ${outcome.baseLabel}: ${outcome.failures.length} failure(s)`);
        for (const f of outcome.failures) io.out(`  ${f}`);
        return 1;
      }
      io.out(`no regression against ${outcome.baseLabel}`);
      return 0;
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

export async function main(argv: readonly string[], cx: BenchContext, io: BenchIo): Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    io.err(name === undefined ? usage() : `unknown command ${name}\n${usage()}`);
    return 2;
  }
  try {
    return await command.run(cx, parseArgs(rest, command.args), io);
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
