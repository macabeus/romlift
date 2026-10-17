// `romlift analyze <rom> [--json] [--disable <rule>...]` (architecture §2.1): the discover analysis of a
// bare ROM. The shell reads and hashes the file; core/workflow/discover does the rest. Text: a table of
// the functions, then the rejections, then the summary, on stdout; diagnostics on stderr. --json: one
// {"type":"function"} line per function in entry order, one {"type":"rejection"} line per rejection in
// (at, mode) order, the diagnostics, then the summary line. Addresses are hexAddr strings; nothing in the
// output names a path, a time or a locale, so two runs of one ROM print the same bytes (g2.determinism).
// --disable turns registered rules off through the internal tuning (D37); an unknown id is a usage error.
// Exit codes: 0 ok, 1 an error diagnostic (E_IO_READ, E_ROM_NOT_GBA), 2 usage.
import type { AnalysisResult, FunctionFact } from '../../api/analysis.ts';
import { readRom } from '../../api/files.ts';
import type { Rejection } from '../../api/profile.ts';
import { hexAddr } from '../../api/rom.ts';
import { disabledTuning, discoverTuned, parseRuleIds } from '../../core/workflow/discover.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { columns, formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, provenanceJson, spanJson, usageError } from './analysis-records.ts';

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

/** The --json output of a finished analysis. */
export function analyzeNdjson(result: AnalysisResult, summary: RunSummary): string {
  return [
    ...result.functions.map((f) => recordLine('function', functionRecord(f))),
    ...result.rejections.map((r) => recordLine('rejection', rejectionRecord(r))),
    ...result.diagnostics.map(diagnosticLine),
    summaryLine(summary),
  ].join('');
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

/** The text output: the function table and the rejections on stdout, the diagnostics on stderr. */
export function analyzeText(result: AnalysisResult, summary: RunSummary): { readonly stdout: string; readonly stderr: string } {
  let stdout = '';
  if (result.functions.length > 0) stdout += columns([FUNCTION_HEADER, ...result.functions.map(functionRow)]);
  if (result.rejections.length > 0) stdout += `rejections:\n${columns(result.rejections.map(rejectionRow), '  ')}`;
  stdout += `analyze: ${formatSummaryText(summary)}\n`;
  return { stdout, stderr: result.diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join('') };
}

export const analyzeCommand: CommandSpec = {
  name: 'analyze',
  summary: 'Finds the functions of a ROM (discover mode): origin, provenance, rejections, diagnostics',
  usage: 'analyze <rom> [--json] [--disable <rule>...]',
  positionals: [{ name: '<rom>' }],
  options: [
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per function, rejection and diagnostic, then a summary' },
    { name: 'disable', kind: 'repeat', summary: 'Turns an analysis rule off (internal tuning, outside semver)', value: '<rule>' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
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
      io.stdout(analyzeNdjson(result, summary));
    } else {
      const text = analyzeText(result, summary);
      if (text.stderr !== '') io.stderr(text.stderr);
      io.stdout(text.stdout);
    }
    return summary.exitCode;
  },
};
