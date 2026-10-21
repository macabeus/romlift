// `romlift analyze <rom> [--json] [--disable <rule>...]` (architecture §2.1): the discover analysis of a
// bare ROM. The shell reads and hashes the file; core/workflow/discover does the rest. Text: a table of
// the functions, then the rejections, then the summary, on stdout; diagnostics on stderr. --json: one
// {"type":"function"} line per function in entry order, one {"type":"rejection"} line per rejection in
// (at, mode) order, the diagnostics, then the summary line. Addresses are hexAddr strings; nothing in the
// output names a path, a time or a locale, so two runs of one ROM print the same bytes (g2.determinism).
// --disable turns registered rules off through the internal tuning (D37); an unknown id is a usage error.
// Exit codes: 0 ok, 1 an error diagnostic (E_IO_READ, E_ROM_NOT_GBA), 2 usage.
//
// `romlift analyze --update [--write] [--json]` (phase 4, architecture §2.1, §6.5): inside a project, what the
// analysis proposes for its romlift.toml (core/workflow/analyze-update.ts): one line per proposal (text) or
// {"type":"proposal","kind","addr","mode","label"?,"rule"} (--json), the reports (W_LISTED_INVALID), the patch as a
// unified diff ({"type":"patch","path","changed","diff"} with --json), then the summary. The patch keeps every
// comment and re-parses; --write saves it (shell/config/save.ts, under the project lock), and nothing else ever
// writes the TOML but `init` and phase 6's `rename` (`import-legacy` was dropped with phase 5, D76 g). Exit codes: 0 ok, 1 an error diagnostic (no project,
// another ROM, E_TOML_PATCH_REFUSED, a write that failed), 2 usage (a ROM argument with --update, --write alone).
import type { AnalysisResult, FunctionFact } from '../../api/analysis.ts';
import { readRom } from '../../api/files.ts';
import type { Rejection } from '../../api/profile.ts';
import type { Diagnostic } from '../../api/rom.ts';
import { hexAddr } from '../../api/rom.ts';
import type { Proposal } from '../../api/config-types.ts';
import { analyzeUpdate, staleConfigProblems } from '../../core/workflow/analyze-update.ts';
import { unifiedDiff } from '../../api/workflow-one-shot.ts';
import { disabledTuning, discoverTuned, parseRuleIds } from '../../core/workflow/discover.ts';
import { saveConfig } from '../../shell/config/save.ts';
import { withProjectLock } from '../../shell/project/lock.ts';
import { readProject, readProjectTexts } from '../../shell/project/read-inputs.ts';
import type { CliIo } from '../registry.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { columnLines, formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, provenanceJson, spanJson, usageError, writeLines } from './command-common.ts';

// The analyze output.

/** The {"type":"function"} record of one function. */
export function functionRecord(f: FunctionFact): RecordFields {
  return {
    entry: hexAddr(f.entry),
    mode: f.mode,
    runAt: f.runAt === undefined ? undefined : hexAddr(f.runAt),
    extent: spanJson(f.extent),
    codeEnd: hexAddr(f.codeEnd),
    origin: f.origin,
    accepted: provenanceJson(f.accepted),
    also: f.also.map(provenanceJson),
  };
}

/** The {"type":"rejection"} record of one rejection. */
export function rejectionRecord(r: Rejection): RecordFields {
  return {
    at: hexAddr(r.at),
    mode: r.mode,
    rule: r.rule,
    reason: r.reason,
    intrinsic: r.intrinsic,
    round: r.round,
    detail: r.detail,
    count: r.count,
  };
}

/** The summary of a run: its exit code and the counts of what it printed. */
export function analyzeSummary(result: AnalysisResult, exitCode: ExitCode): RunSummary {
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: { functions: result.functions.length, rejections: result.rejections.length, diagnostics: result.diagnostics.length },
  };
}

/** The --json lines of a finished analysis, built one at a time (a 32 MiB ROM has over 600,000 rejections). */
export function* analyzeNdjsonLines(result: AnalysisResult, summary: RunSummary): Generator<string> {
  for (const f of result.functions) yield recordLine('function', functionRecord(f));
  for (const r of result.rejections) yield recordLine('rejection', rejectionRecord(r));
  for (const d of result.diagnostics) yield diagnosticLine(d);
  yield summaryLine(summary);
}

/** The --json output of a finished analysis, as one string. */
export function analyzeNdjson(result: AnalysisResult, summary: RunSummary): string {
  return [...analyzeNdjsonLines(result, summary)].join('');
}

const FUNCTION_HEADER = ['entry', 'mode', 'extent', 'code end', 'origin', 'accepted', 'also'];

function functionRow(f: FunctionFact): readonly string[] {
  return [
    hexAddr(f.entry),
    f.mode,
    `${hexAddr(f.extent.start)}..${hexAddr(f.extent.end)}`,
    hexAddr(f.codeEnd),
    f.origin,
    f.accepted.note === undefined ? f.accepted.rule : `${f.accepted.rule} (${f.accepted.note})`,
    f.also.map((p) => p.rule).join(', '),
  ];
}

function rejectionRow(r: Rejection): readonly string[] {
  return [hexAddr(r.at), r.mode, r.rule, r.reason, `x${r.count}`, r.detail];
}

/** The text output's stdout lines, built one at a time: the function table, the rejections, the summary. */
export function* analyzeTextLines(result: AnalysisResult, summary: RunSummary): Generator<string> {
  const functions = result.functions;
  const rejections = result.rejections;
  if (functions.length > 0) yield* columnLines(functions.length + 1, (k) => (k === 0 ? FUNCTION_HEADER : functionRow(functions[k - 1] as FunctionFact)));
  if (rejections.length > 0) {
    yield 'rejections:\n';
    yield* columnLines(rejections.length, (k) => rejectionRow(rejections[k] as Rejection), '  ');
  }
  yield `analyze: ${formatSummaryText(summary)}\n`;
}

/** The text output's diagnostics, for stderr. */
function analyzeTextDiagnostics(result: AnalysisResult): string {
  return result.diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join('');
}

// The --update output.

/** The {"type":"proposal"} record of one proposal. */
export function proposalRecord(p: Proposal): RecordFields {
  switch (p.kind) {
    case 'function':
      return { kind: p.kind, addr: hexAddr(p.addr), mode: p.mode, name: p.name, label: p.label, source: p.source.kind, rule: 'rule' in p.source ? p.source.rule : undefined };
    case 'symbol':
      return { kind: p.kind, addr: hexAddr(p.addr), name: p.name, source: p.source.kind };
    case 'module':
      return { kind: p.kind, addr: hexAddr(p.start), name: p.name, source: p.source.kind };
    case 'override':
      return { kind: p.kind, addr: hexAddr(p.span.start), end: hexAddr(p.span.end), source: p.source.kind };
  }
}

function proposalText(p: Proposal): string {
  const record = proposalRecord(p);
  const rule = typeof record['rule'] === 'string' ? ` (${record['rule']})` : '';
  const label = record['label'] === true ? ', label' : '';
  return `${p.kind} ${String(record['addr'])}${typeof record['mode'] === 'string' ? ` ${record['mode']}` : ''}${label}${rule}\n`;
}

/** Runs `analyze --update [--write]` in the project that holds `io.cwd`. */
async function runUpdate(io: CliIo, json: boolean, write: boolean): Promise<ExitCode> {
  const read = await readProject(io.cwd, { withoutC: true });
  if (!read.ok) {
    printDiagnosticsOnly(io, json, 'analyze --update', read.diagnostics, { ok: false, exitCode: ExitCode.errors });
    return ExitCode.errors;
  }
  const project = read.value;
  const plan = analyzeUpdate(project.inputs);
  if (!plan.ok) {
    printDiagnosticsOnly(io, json, 'analyze --update', plan.diagnostics, { ok: false, exitCode: ExitCode.errors });
    return ExitCode.errors;
  }
  const path = project.config.project.config;
  let diagnostics: readonly Diagnostic[] = plan.diagnostics;
  let written = false;
  if (write && plan.changed) {
    // Under the lock: the config on disk must still be the text the plan was made from (D75 m).
    const saved = await withProjectLock(project.dir, async () => {
      const now = await readProjectTexts(project.dir, [path]);
      const problem = now.ok ? staleConfigProblems(path, project.inputs.configText, now.value.get(path) ?? '')[0] : now.diagnostics[0];
      return problem === undefined ? saveConfig(project.dir, plan.text, path) : ({ ok: false, diagnostic: problem } as const);
    });
    if (!saved.ok) diagnostics = [...diagnostics, ...saved.diagnostics];
    else {
      diagnostics = [...diagnostics, ...saved.diagnostics];
      if (saved.value.ok) written = true;
      else diagnostics = [...diagnostics, saved.value.diagnostic];
    }
  }
  const exitCode = exitCodeOf(diagnostics);
  const diff = unifiedDiff(project.inputs.configText, plan.text, path);
  const summary: RunSummary = { ok: exitCode === ExitCode.ok, exitCode, counts: { proposals: plan.proposals.length, written: written ? 1 : 0, diagnostics: diagnostics.length } };
  if (json) {
    await writeLines(io, [
      ...plan.proposals.map((p) => recordLine('proposal', proposalRecord(p))),
      recordLine('patch', { path, changed: plan.changed, written, diff }),
      ...diagnostics.map(diagnosticLine),
      summaryLine(summary),
    ]);
    return exitCode;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  const verdict = !plan.changed ? `${path} is up to date` : written ? `wrote ${path}` : `run \`romlift analyze --update --write\` to apply the patch to ${path}`;
  await writeLines(io, [...plan.proposals.map(proposalText), diff, `${verdict}\n`, `analyze --update: ${formatSummaryText(summary)}\n`]);
  return exitCode;
}

export const analyzeCommand: CommandSpec = {
  name: 'analyze',
  summary: "Finds the functions of a ROM (discover mode): origin, provenance, rejections, diagnostics; --update proposes a patch of the project's romlift.toml",
  usage: 'analyze <rom> [--json] [--disable <rule>...] | analyze --update [--write] [--json]',
  positionals: [{ name: '<rom>', optional: true }],
  options: [
    { name: 'update', kind: 'boolean', summary: "Inside a project: proposes what the analysis finds that romlift.toml lacks, as a patch that keeps its comments" },
    { name: 'write', kind: 'boolean', summary: 'With --update: saves the patched romlift.toml' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per function, rejection and diagnostic, then a summary' },
    { name: 'disable', kind: 'repeat', summary: 'Turns an analysis rule off (internal tuning, outside semver)', value: '<rule>' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const update = args.flags['update'] === true;
    if (args.flags['write'] === true && !update) return usageError(io, 'analyze', '--write goes with --update');
    if (update) {
      if (args.positionals.length > 0) return usageError(io, 'analyze', "--update reads the project's ROM; give no <rom>");
      if ((args.repeated['disable'] ?? []).length > 0) return usageError(io, 'analyze', '--disable does not go with --update');
      return runUpdate(io, json, args.flags['write'] === true);
    }
    if (args.positionals.length === 0) return usageError(io, 'analyze', 'needs <rom> (or --update inside a project)');
    const disabled = parseRuleIds(args.repeated['disable'] ?? []);
    if (disabled.unknown.length > 0) return usageError(io, 'analyze', `--disable names no analysis rule: ${disabled.unknown.join(', ')}`);
    const path = args.positionals[0] ?? '';
    const loaded = await readRom(path);
    if (!loaded.ok) {
      const summary: RunSummary = { ok: false, exitCode: ExitCode.errors, counts: { functions: 0, rejections: 0, diagnostics: 1 } };
      printDiagnosticsOnly(io, json, 'analyze', [loaded.diagnostic], summary);
      return ExitCode.errors;
    }
    const result = discoverTuned(loaded.value, {}, disabledTuning(disabled.known));
    const summary = analyzeSummary(result, exitCodeOf(result.diagnostics));
    if (json) {
      await writeLines(io, analyzeNdjsonLines(result, summary));
    } else {
      // Streamed as --json is (D70 a): the whole table of a 32 MiB ROM is never one string.
      const stderr = analyzeTextDiagnostics(result);
      if (stderr !== '') io.stderr(stderr);
      await writeLines(io, analyzeTextLines(result, summary));
    }
    return summary.exitCode;
  },
};
