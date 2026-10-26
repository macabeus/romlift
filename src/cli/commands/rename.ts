// `romlift rename <old> <new> [--json]` (architecture §2.1, §6.6, roadmap 6.E, D9, D92): inside a project, renames a
// function or symbol (or an alias of one): romlift.toml's entry on one line, its `from` key dropped, and the identifier
// tokens <old> of src/**/*.c, src/**/*.h and include/**, never a comment, string or character literal
// (shell/project/rename-project.ts renameInProject, under the project lock; core/workflow/rename.ts decides). It never
// runs `generate`: the chunk file follows at the next one. Text: one line per edited file and the TOML's, then the
// summary; diagnostics on stderr. --json: one {"type":"edit","path","op","identifiers"} line per edited file, a
// {"type":"patch","path","written"} line for romlift.toml, the diagnostics, then the summary. Exit codes: 0 ok,
// 1 a refusal or a failed write (E_RENAME_UNKNOWN, E_RENAME_EXISTS, E_RENAME_INVALID, E_TOML_PATCH_REFUSED,
// E_STALE_EDIT, E_STALE_CONFIG, E_RENAME_INTERRUPTED, no project, a locked project), with no file changed by a refusal;
// 2 usage.
import type { Diagnostic } from '../../api/rom.ts';
import type { RenameOutcome } from '../../shell/project/rename-project.ts';
import { renameInProject } from '../../shell/project/rename-project.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, writeLines } from './command-common.ts';

/** Each edited file's path, its op (edit, or keep when nothing changed) and how many identifiers its edits rename. */
function editedFiles(outcome: RenameOutcome): readonly { readonly path: string; readonly op: string; readonly identifiers: number }[] {
  const ops = new Map(outcome.ops.map((op) => [op.path, op.op] as const));
  return outcome.edits.map((e) => ({ path: e.path, op: ops.get(e.path) ?? 'edit', identifiers: e.edits.length }));
}

/** The exit code of an outcome: 1 when it is not ok or raised an error, else 0. */
function renameExitCode(outcome: RenameOutcome): ExitCode {
  return !outcome.ok ? ExitCode.errors : exitCodeOf(outcome.diagnostics);
}

async function printOutcome(io: CliIo, json: boolean, outcome: RenameOutcome, summary: RunSummary): Promise<void> {
  const files = outcome.ok ? editedFiles(outcome) : [];
  if (json) {
    const patch = outcome.configPath === undefined ? [] : [recordLine('patch', { path: outcome.configPath, written: outcome.tomlWritten })];
    await writeLines(io, [...files.map((f) => recordLine('edit', f)), ...patch, ...outcome.diagnostics.map(diagnosticLine), summaryLine(summary)]);
    return;
  }
  if (outcome.diagnostics.length > 0) io.stderr(outcome.diagnostics.map((d: Diagnostic) => `${formatDiagnosticText(d)}\n`).join(''));
  const toml = outcome.tomlWritten && outcome.configPath !== undefined ? [`patch  ${outcome.configPath}\n`] : [];
  const lines = files.map((f) => `${f.op.padEnd(6)} ${f.path} (${f.identifiers} ${f.identifiers === 1 ? 'identifier' : 'identifiers'})\n`);
  await writeLines(io, [...lines, ...toml, `rename: ${formatSummaryText(summary)}\n`]);
}

export const renameCommand: CommandSpec = {
  name: 'rename',
  summary:
    "Renames a function or symbol of romlift.toml: its entry on one line (its `from` dropped) and the identifiers in src/ and include/, never comments or strings; a default data label (gUnk_…) needs a [symbols] entry first",
  usage: 'rename <old> <new> [--json]',
  positionals: [{ name: '<old>' }, { name: '<new>' }],
  options: [{ name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per edited file, the TOML patch, the diagnostics, then a summary' }],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const [from = '', to = ''] = args.positionals;
    const outcome = await renameInProject(io.cwd, from, to);
    const exitCode = renameExitCode(outcome);
    const files = outcome.ok ? editedFiles(outcome) : [];
    const summary: RunSummary = {
      ok: exitCode === ExitCode.ok,
      exitCode,
      counts: { files: files.filter((f) => f.op === 'edit').length, identifiers: files.reduce((n, f) => n + f.identifiers, 0), toml: outcome.tomlWritten ? 1 : 0, diagnostics: outcome.diagnostics.length },
    };
    await printOutcome(io, json, outcome, summary);
    return exitCode;
  },
};
