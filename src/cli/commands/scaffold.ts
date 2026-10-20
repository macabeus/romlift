// `romlift scaffold --diff [--json]` (architecture §2.1, §6.3 "The scaffold", §6.4: "scaffold --diff shows template
// drift"; D74 b moved the command here from 4.B): how the scaffold files of the project that holds the working
// directory differ from what the running romlift's templates render for it. The scaffold is written once by `init`
// and is the user's from then on, so nothing is ever written: one line per scaffold file, `same`, `differs` (with the
// unified diff from the file on disk to the rendered template) or `absent`, then the summary; with --json,
// {"type":"scaffold","path","status","diff"} lines, the diagnostics, then the summary. The scaffold is rendered from
// the project's [build] name, its ROM's SHA-1 and header title, and the package's templates, agbcc pin and version.
// Exit codes: 0 (whatever drifted), 1 an error diagnostic (no project, an unreadable file), 2 usage (no --diff).
import { projectScaffold, scaffoldDrift } from '../../core/workflow/scaffold-diff.ts';
import type { ScaffoldDrift } from '../../core/workflow/scaffold-diff.ts';
import { readProject, readProjectTexts, readScaffoldInputs } from '../../shell/project/read-inputs.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CommandSpec } from '../registry.ts';
import { recordLine, summaryLine } from '../reporters/ndjson.ts';
import { formatSummaryText } from '../reporters/text.ts';
import { printDiagnosticsOnly, usageError, writeLines } from './analysis-records.ts';

/** The counts of a drift report: files by status. */
export function driftCounts(drift: readonly ScaffoldDrift[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = { same: 0, differs: 0, absent: 0 };
  for (const d of drift) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return counts;
}

function driftText(d: ScaffoldDrift): string {
  return `${d.status.padEnd(7)} ${d.path}\n${d.diff}`;
}

export const scaffoldCommand: CommandSpec = {
  name: 'scaffold',
  summary: "Shows how the project's scaffold files (Makefile, setup.sh, AGENTS.md, …) differ from the current templates; writes nothing",
  usage: 'scaffold --diff [--json]',
  positionals: [],
  options: [
    { name: 'diff', kind: 'boolean', summary: 'Compares each scaffold file with what the current templates render for this project' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per scaffold file, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    if (args.flags['diff'] !== true) return usageError(io, 'scaffold', 'needs --diff (the scaffold is written by init only)');
    const refuse = (diagnostics: Parameters<typeof printDiagnosticsOnly>[3]): ExitCode => {
      printDiagnosticsOnly(io, json, 'scaffold --diff', diagnostics, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    };
    const read = await readProject(io.cwd, { withoutC: true });
    if (!read.ok) return refuse(read.diagnostics);
    const inputs = await readScaffoldInputs();
    if (!inputs.ok) return refuse(inputs.diagnostics);
    const { config, rom } = read.value.inputs;
    const entries = projectScaffold({ name: config.build.name, sha1: config.rom.sha1, title: rom.header.title, ...inputs.value });
    const current = await readProjectTexts(read.value.dir, entries.map((e) => e.path));
    if (!current.ok) return refuse(current.diagnostics);
    const drift = scaffoldDrift(entries, current.value);
    const summary: RunSummary = { ok: true, exitCode: ExitCode.ok, counts: driftCounts(drift) };
    if (json) {
      await writeLines(io, [...drift.map((d) => recordLine('scaffold', { path: d.path, status: d.status, diff: d.diff })), summaryLine(summary)]);
    } else {
      await writeLines(io, [...drift.map(driftText), `scaffold --diff: ${formatSummaryText(summary)}\n`]);
    }
    return ExitCode.ok;
  },
};
