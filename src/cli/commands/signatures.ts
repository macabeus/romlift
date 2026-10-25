// `romlift signatures build <spec> [--out <dir>] [--json]` (architecture §2.1, §7.1, §7.2, D40, roadmap 6.A): builds
// `<out>/<library>.json` (default `<repo>/signatures/`, gitignored) from a spec in signatures/specs/ and its reference
// datasets (shell/signatures/build-from-references.ts). Text: one line per version, the diagnostics on stderr, the
// file written and the summary. --json: one {"type":"version","library","version","functions","tables","references"}
// line per version, the diagnostics, then the summary. Exit codes: 0 built (warnings allowed), 1 a spec or reference
// error (nothing written), 2 usage.
//
// `romlift signatures <rom> [--signatures <dir>] [--json]` (architecture §2.1, §7.2, roadmap 6.B): where the built
// signature files place their members on a ROM. The shell reads the ROM and locates the files (`--signatures <dir>`,
// else `$ROMLIFT_SIGNATURES`, else the package's signatures/, shell/signatures/locate.ts); the discover analysis, the
// matcher and the overlap resolution are the core's (matchSignatures, resolvePlacements). --json: one
// {"type":"placement","library","version","member","name","kind","addr","size","mode"?,"rule","constants"?} line per
// settled placement in address order (addr a hexAddr string; each constant {offset, reference, rom}, the word values
// as hexAddr strings), one {"type":"region","library","version","start","end"} line per library region, the
// diagnostics (the locator's, the analysis', the matcher's and the resolver's), then the summary. Text: one line per
// placement and region, the diagnostics on stderr, the summary. No built file found: W_SIGNATURES_ABSENT, nothing
// placed, exit 0. Exit codes: 0 ok (warnings allowed), 1 an error diagnostic (the ROM cannot be read or is no GBA
// cartridge), 2 usage.
import type { LibraryRegion } from '../../api/config-types.ts';
import { readRom } from '../../api/files.ts';
import { hexAddr } from '../../api/rom.ts';
import type { Diagnostic } from '../../api/rom.ts';
import { matchSignatures, resolvePlacements } from '../../api/signatures-match.ts';
import type { ResolvedSignatures } from '../../api/signatures-match.ts';
import type { SignatureFile, SignaturePlacement } from '../../api/signatures-types.ts';
import { discover } from '../../core/workflow/discover.ts';
import { buildSignatures, signaturesRepoOf, writeSignatureFile } from '../../shell/signatures/build-from-references.ts';
import { locateSignatures, signaturesAbsent, SIGNATURES_ENV } from '../../shell/signatures/locate.ts';
import { packageRoot, resolveFrom } from '../../shell/project/read-inputs.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import type { RecordFields } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, usageError, writeLines } from './command-common.ts';

const COMMAND = 'signatures';
const BUILD = 'build';

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

// ---------------------------------------------------------------------------------------------------
// `signatures <rom>`: the matcher's form.

/** The {"type":"placement"} record of one settled placement. */
export function placementRecord(p: SignaturePlacement): RecordFields {
  return {
    library: p.library,
    version: p.version,
    member: p.member,
    name: p.name,
    kind: p.kind,
    addr: hexAddr(p.addr),
    size: p.size,
    mode: p.mode,
    rule: p.rule,
    constants: p.constants?.map((c) => ({ offset: c.offset, reference: hexAddr(c.reference), rom: hexAddr(c.rom) })),
  };
}

/** The {"type":"region"} record of one library region. */
export function regionRecord(r: LibraryRegion): RecordFields {
  return { library: r.library, version: r.version, start: hexAddr(r.span.start), end: hexAddr(r.span.end) };
}

function placementText(p: SignaturePlacement): string {
  const mode = p.mode === undefined ? '' : ` ${p.mode}`;
  const constants = p.constants === undefined || p.constants.length === 0 ? '' : `, ${p.constants.length} constants`;
  return `${hexAddr(p.addr)} ${p.kind}${mode} ${p.name} (${p.member}, ${p.library}@${p.version}) size ${p.size} ${p.rule}${constants}\n`;
}

function regionText(r: LibraryRegion): string {
  return `region ${hexAddr(r.span.start)}..${hexAddr(r.span.end)} ${r.library}@${r.version}\n`;
}

/** The summary of a match: its exit code and its counts. */
export function matchSummary(files: number, resolved: Pick<ResolvedSignatures, 'placements' | 'regions'> | undefined, diagnostics: readonly Diagnostic[], exitCode: ExitCode): RunSummary {
  const placements = resolved?.placements ?? [];
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: {
      files,
      placements: placements.length,
      functions: placements.filter((p) => p.kind === 'function').length,
      tables: placements.filter((p) => p.kind === 'table').length,
      regions: resolved?.regions.length ?? 0,
      diagnostics: diagnostics.length,
    },
  };
}

/** `signatures <rom>`: read, locate, analyse, match, settle, report. */
async function runMatch(io: CliIo, romArg: string, dirArg: string | undefined, json: boolean): Promise<ExitCode> {
  const loaded = await readRom(resolveFrom(io.cwd, romArg));
  if (!loaded.ok) {
    printDiagnosticsOnly(io, json, COMMAND, [loaded.diagnostic], matchSummary(0, undefined, [loaded.diagnostic], ExitCode.errors));
    return ExitCode.errors;
  }
  const env = dirArg === undefined ? io.env : { ...io.env, [SIGNATURES_ENV]: dirArg };
  const located = await locateSignatures({ packageRoot: packageRoot(), env, cwd: io.cwd });
  const absent = signaturesAbsent(located);
  const rom = loaded.value;
  const analysis = discover(rom);
  const analysed = analysis.diagnostics.some((d) => d.severity === 'error');
  const resolved = located.files.length === 0 || analysed ? undefined : resolvePlacements(rom, matchSignatures(rom, analysis, located.files));
  const diagnostics: readonly Diagnostic[] = [...located.diagnostics, ...(absent === undefined ? [] : [absent]), ...analysis.diagnostics, ...(resolved?.diagnostics ?? [])];
  const exitCode = exitCodeOf(diagnostics);
  const summary = matchSummary(located.files.length, resolved, diagnostics, exitCode);
  const placements = resolved?.placements ?? [];
  const regions = resolved?.regions ?? [];
  if (json) {
    await writeLines(io, [
      ...placements.map((p) => recordLine('placement', placementRecord(p))),
      ...regions.map((r) => recordLine('region', regionRecord(r))),
      ...diagnostics.map(diagnosticLine),
      summaryLine(summary),
    ]);
    return exitCode;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  await writeLines(io, [...placements.map(placementText), ...regions.map(regionText), `${COMMAND}: ${formatSummaryText(summary)}\n`]);
  return exitCode;
}

export const signaturesCommand: CommandSpec = {
  name: COMMAND,
  summary: 'Places the built library signatures on a ROM (signatures <rom>), or builds a signature file from a spec (signatures build <spec>)',
  usage: 'signatures <rom> [--signatures <dir>] [--json] | signatures build <spec> [--out <dir>] [--json]',
  positionals: [{ name: '<rom>|build' }, { name: '<spec>', optional: true }],
  options: [
    { name: 'signatures', kind: 'string', summary: 'With <rom>: the directory of built signature files to read (default $ROMLIFT_SIGNATURES, else the package\'s signatures/)', value: '<dir>' },
    { name: 'out', kind: 'string', summary: "With build: the directory <library>.json is written to (default the repository's signatures/)", value: '<dir>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per placement and region (or per built version) and diagnostic, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const [first, second] = args.positionals;
    if (first === BUILD) {
      if (second === undefined) return usageError(io, COMMAND, 'build needs <spec>');
      if (args.options['signatures'] !== undefined) return usageError(io, COMMAND, '--signatures goes with signatures <rom>, not build');
      return runBuild(io, second, args.options['out'], json);
    }
    if (first === undefined) return usageError(io, COMMAND, 'needs <rom> or build <spec>');
    if (second !== undefined) return usageError(io, COMMAND, `signatures <rom> takes one argument, not '${second}'`);
    if (args.options['out'] !== undefined) return usageError(io, COMMAND, '--out goes with signatures build');
    return runMatch(io, first, args.options['signatures'], json);
  },
};
