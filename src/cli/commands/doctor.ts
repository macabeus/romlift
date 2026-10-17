// `romlift doctor [--json] [--full]` (architecture §2.1): runs the toolchain checks of runDoctor and
// prints them. Text: one line per check, then the verdict. --json: one {"type":"check",id,status,detail}
// line per check in report order, the diagnostics, then the summary line. Exit 0 when binutils, the
// corpus and the JUMP11 probe are ok; 1 when the binutils are missing or cannot run; 3 when the corpus
// or the probe disagrees.
import { DOCTOR_REQUIRED, runDoctor } from '../../api/toolchain.ts';
import type { DoctorCheck, DoctorReport } from '../../api/toolchain.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';

/** The exit code of a report: the binutils first, then the corpus and the probe. */
export function doctorExitCode(report: DoctorReport): ExitCode {
  const status = (id: DoctorCheck['id']): DoctorCheck['status'] | undefined => report.checks.find((c) => c.id === id)?.status;
  if (status('binutils') !== 'ok') return ExitCode.errors;
  return DOCTOR_REQUIRED.every((id) => status(id) === 'ok') ? ExitCode.ok : ExitCode.verifyFailed;
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
  options: [
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per check, the diagnostics, then a summary' },
    { name: 'full', kind: 'boolean', summary: 'Runs the CI-size corpus (an ARM sample of 2^20 words)' },
  ],
  async run(args, io) {
    const report = await runDoctor({ env: io.env, cwd: io.cwd, full: args.flags['full'] === true });
    const exitCode = doctorExitCode(report);
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
