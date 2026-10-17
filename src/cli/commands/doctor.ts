// `romlift doctor [--json] [--full]` (architecture §2.1): runs the toolchain checks of runDoctor and
// prints them. Text: one line per check, then the verdict. --json: one {"type":"check",id,status,detail}
// line per check in report order, the diagnostics, then the summary line. The exit code is the report's
// verdict (core/workflow/doctor.ts) mapped: ok 0, unusable (binutils missing or not running) 1,
// disagrees (the corpus or the probe) 3.
import { runDoctor } from '../../api/toolchain.ts';
import type { DoctorCheck, DoctorReport, DoctorVerdict } from '../../api/toolchain.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';

const EXIT_CODES: Readonly<Record<DoctorVerdict, ExitCode>> = { ok: ExitCode.ok, unusable: ExitCode.errors, disagrees: ExitCode.verifyFailed };

/** The exit code of a verdict. */
export function doctorExitCode(verdict: DoctorVerdict): ExitCode {
  return EXIT_CODES[verdict];
}

function checkLine(check: DoctorCheck, width: number): string {
  return `${check.id.padEnd(width)}  ${check.status.padEnd(7)}  ${check.detail}\n`;
}

/** The text output: the checks, then the verdict, on stdout; diagnostics on stderr. */
export function doctorText(report: DoctorReport, summary: RunSummary): { readonly stdout: string; readonly stderr: string } {
  const width = report.checks.reduce((max, c) => Math.max(max, c.id.length), 0);
  return {
    stdout: `${report.checks.map((c) => checkLine(c, width)).join('')}doctor: ${formatSummaryText(summary)}\n`,
    stderr: report.diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''),
  };
}

/** The --json output: check lines in report order, diagnostic lines, and the summary last. */
export function doctorNdjson(report: DoctorReport, summary: RunSummary): string {
  return [
    ...report.checks.map((c) => recordLine('check', { id: c.id, status: c.status, detail: c.detail })),
    ...report.diagnostics.map(diagnosticLine),
    summaryLine(summary),
  ].join('');
}

export const doctorCommand: CommandSpec = {
  name: 'doctor',
  summary: 'Checks the toolchain: binutils, the as round-trip corpus, the JUMP11 probe, agbcc',
  usage: 'doctor [--json] [--full]',
  positionals: [],
  options: [
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per check, the diagnostics, then a summary' },
    { name: 'full', kind: 'boolean', summary: 'Runs the CI-size corpus (an ARM sample of 2^20 words)' },
  ],
  async run(args, io) {
    const report = await runDoctor({ env: io.env, cwd: io.cwd, full: args.flags['full'] === true });
    const exitCode = doctorExitCode(report.verdict);
    const summary: RunSummary = { ok: exitCode === ExitCode.ok, exitCode };
    if (args.flags['json'] === true) {
      io.stdout(doctorNdjson(report, summary));
    } else {
      const text = doctorText(report, summary);
      if (text.stderr !== '') io.stderr(text.stderr);
      io.stdout(text.stdout);
    }
    return exitCode;
  },
};
