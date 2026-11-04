// What the commands share: exit codes from diagnostics (a refusal's and a checked run's, which tell a self-check from an
// input error), usage errors raised after parsing, the JSON shapes of spans and provenance, the op counts of a write,
// printing a failure that came before any analysis, and batched NDJSON output. One module, so no command imports
// another's helpers (D77 j; fix round 3 moved verifyExitCode here and named the module for what it holds, D78 f).
import type { Provenance } from '../../api/profile.ts';
import { hexAddr } from '../../api/rom.ts';
import type { Diagnostic, Span } from '../../api/rom.ts';
import { VerifyCodes } from '../../core/diagnostic-codes.ts';
import type { VerifyReport } from '../../api/verify.ts';
import type { WriteOp } from '../../api/write-plan.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import { PROGRAM } from '../registry.ts';
import type { CliIo } from '../registry.ts';
import { diagnosticLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';

/** The codes of the self-checks: an error among them is exit 3, any other error exit 1. */
export const VERIFY_CODES: ReadonlySet<string> = new Set(Object.keys(VerifyCodes));

/**
 * The exit code of a refusal that planned nothing: 1 when an error diagnostic is not a self-check's (the input or the
 * model is wrong), else 3 (a self-check failed; also when nothing says why, since only a check refuses silently).
 */
export function refusedExitCode(diagnostics: readonly Diagnostic[]): ExitCode {
  return diagnostics.some((d) => d.severity === 'error' && !VERIFY_CODES.has(d.code)) ? ExitCode.errors : ExitCode.verifyFailed;
}

/** Every diagnostic of a checked run: the analysis and model ones, then each check's, in report order. */
export function allDiagnostics(outcome: { readonly report: VerifyReport; readonly diagnostics: readonly Diagnostic[] }): readonly Diagnostic[] {
  return [...outcome.diagnostics, ...outcome.report.checks.flatMap((c) => c.diagnostics)];
}

/**
 * The exit code of a checked run (`generate`'s check pass): 1 when an error diagnostic is not a
 * self-check's (the input, the model or the toolchain is wrong), else 3 when a check failed, else 0 (architecture
 * §2.1, D33). The diagnostics are allDiagnostics'.
 */
export function verifyExitCode(outcome: { readonly report: VerifyReport; readonly diagnostics: readonly Diagnostic[] }): ExitCode {
  if (allDiagnostics(outcome).some((d) => d.severity === 'error' && !VERIFY_CODES.has(d.code))) return ExitCode.errors;
  return outcome.report.ok ? ExitCode.ok : ExitCode.verifyFailed;
}

/** The counts of a write: ops by kind. */
export function opCounts(ops: readonly WriteOp[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = { write: 0, edit: 0, delete: 0, keep: 0 };
  for (const op of ops) counts[op.op] = (counts[op.op] ?? 0) + 1;
  return counts;
}

/** 1 when any diagnostic is an error, else 0. */
export function exitCodeOf(diagnostics: readonly Diagnostic[]): ExitCode {
  return diagnostics.some((d) => d.severity === 'error') ? ExitCode.errors : ExitCode.ok;
}

/** A usage error raised by a command after parsing: one stderr line and the pointer to its help. */
export function usageError(io: CliIo, command: string, message: string): ExitCode {
  io.stderr(`${PROGRAM}: ${command}: ${message}\nRun '${PROGRAM} ${command} --help' for its options.\n`);
  return ExitCode.usage;
}

/** A span as {start, end} hexAddr strings. */
export function spanJson(span: Span): RecordFields {
  return { start: hexAddr(span.start), end: hexAddr(span.end) };
}

/** A provenance record with its cites as hexAddr strings. */
export function provenanceJson(p: Provenance): RecordFields {
  return { rule: p.rule, round: p.round, cites: p.cites.map(hexAddr), note: p.note };
}

/** Prints a failure that happened before any analysis (the ROM could not be read). */
export function printDiagnosticsOnly(io: CliIo, json: boolean, command: string, diagnostics: readonly Diagnostic[], summary: RunSummary): void {
  if (json) {
    io.stdout([...diagnostics.map(diagnosticLine), summaryLine(summary)].join(''));
    return;
  }
  io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  io.stdout(`${command}: ${formatSummaryText(summary)}\n`);
}

/** How many NDJSON lines a streaming command joins into one stdout write. */
const LINES_PER_WRITE = 4096;

/**
 * Writes `lines` to stdout in batches, awaiting `io.drained` between them: an output of hundreds of thousands of
 * lines (analyze's rejections, model's chunks on a 32 MiB ROM) is never one string or one queue (D69).
 */
export async function writeLines(io: CliIo, lines: Iterable<string>): Promise<void> {
  let batch: string[] = [];
  for (const line of lines) {
    batch.push(line);
    if (batch.length < LINES_PER_WRITE) continue;
    io.stdout(batch.join(''));
    batch = [];
    await io.drained?.();
  }
  if (batch.length > 0) io.stdout(batch.join(''));
}
