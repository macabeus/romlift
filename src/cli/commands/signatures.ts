// `romlift signatures build <spec> [--out <dir>] [--json]` (architecture §2.1, §7.1, §7.2, D40, roadmap 6.A): builds
// `<out>/<library>.json` (default `<repo>/signatures/`, gitignored) from a spec in signatures/specs/ and its reference
// datasets (shell/signatures/build-from-references.ts). Text: one line per version, the diagnostics on stderr, the
// file written and the summary. --json: one {"type":"version","library","version","functions","tables","references"}
// line per version, the diagnostics, then the summary. Exit codes: 0 built (warnings allowed), 1 a spec or reference
// error (nothing written), 2 usage.
//
// `romlift signatures <rom>` is the matcher's form (p6-signatures-match, phase 6 wave 3); until it lands, any first
// positional other than `build` is a usage error that says so.
import type { Diagnostic } from '../../api/rom.ts';
import type { SignatureFile } from '../../api/signatures-types.ts';
import { buildSignatures, signaturesRepoOf, writeSignatureFile } from '../../shell/signatures/build-from-references.ts';
import { resolveFrom } from '../../shell/project/read-inputs.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, usageError, writeLines } from './command-common.ts';

const COMMAND = 'signatures';
const BUILD = 'build';

/** What `signatures <rom>` answers until the matcher lands. */
export const MATCHER_PENDING = 'signatures <rom> needs the matcher (phase 6, wave 3)';

/** The {"type":"version"} record of one built version. */
export function versionRecord(file: SignatureFile, v: SignatureFile['versions'][number]): RecordFields {
  return { library: file.library, version: v.id, functions: v.functions.length, tables: v.tables.length, references: v.references.map((r) => r.dataset) };
}

function versionText(file: SignatureFile, v: SignatureFile['versions'][number]): string {
  return `${file.library} ${v.id}: ${v.functions.length} functions, ${v.tables.length} tables from ${v.references.map((r) => r.dataset).join(', ')}\n`;
}

/** The summary of a build: its exit code and its counts. */
export function buildSummary(file: SignatureFile | undefined, diagnostics: readonly Diagnostic[], exitCode: ExitCode): RunSummary {
  const versions = file?.versions ?? [];
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: {
      versions: versions.length,
      functions: versions.reduce((n, v) => n + v.functions.length, 0),
      tables: versions.reduce((n, v) => n + v.tables.length, 0),
      written: file === undefined ? 0 : 1,
      diagnostics: diagnostics.length,
    },
  };
}

/** `signatures build <spec>`: build, write, report. */
async function runBuild(io: CliIo, specArg: string, outArg: string | undefined, json: boolean): Promise<ExitCode> {
  const specPath = resolveFrom(io.cwd, specArg);
  const benchEnv = io.env['ROMLIFT_BENCH_ROOT'];
  const built = await buildSignatures({ specPath }, benchEnv === undefined || benchEnv === '' ? {} : { benchRoot: resolveFrom(io.cwd, benchEnv) });
  if (!built.ok) {
    printDiagnosticsOnly(io, json, `${COMMAND} ${BUILD}`, built.diagnostics, buildSummary(undefined, built.diagnostics, ExitCode.errors));
    return ExitCode.errors;
  }
  const outDir = outArg === undefined ? resolveFrom(await signaturesRepoOf(specPath), 'signatures') : resolveFrom(io.cwd, outArg);
  const written = await writeSignatureFile(outDir, built.value);
  const diagnostics = written.ok ? built.diagnostics : [...built.diagnostics, written.diagnostic];
  const exitCode = exitCodeOf(diagnostics);
  const file = written.ok ? built.value : undefined;
  const summary = buildSummary(file, diagnostics, exitCode);
  const versions = built.value.versions;
  if (json) {
    await writeLines(io, [...versions.map((v) => recordLine('version', versionRecord(built.value, v))), ...diagnostics.map(diagnosticLine), summaryLine(summary)]);
    return exitCode;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  const wrote = written.ok ? [`wrote ${written.value}\n`] : [];
  await writeLines(io, [...versions.map((v) => versionText(built.value, v)), ...wrote, `${COMMAND} ${BUILD}: ${formatSummaryText(summary)}\n`]);
  return exitCode;
}

export const signaturesCommand: CommandSpec = {
  name: COMMAND,
  summary: 'Builds a library signature file from a spec and its reference datasets (signatures build <spec>)',
  usage: 'signatures build <spec> [--out <dir>] [--json] | signatures <rom> [--json]',
  positionals: [{ name: 'build|<rom>' }, { name: '<spec>', optional: true }],
  options: [
    { name: 'out', kind: 'string', summary: "With build: the directory <library>.json is written to (default the repository's signatures/)", value: '<dir>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per version and diagnostic, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const [first, spec] = args.positionals;
    if (first !== BUILD) return usageError(io, COMMAND, MATCHER_PENDING);
    if (spec === undefined) return usageError(io, COMMAND, 'build needs <spec>');
    return runBuild(io, spec, args.options['out'], json);
  },
};
