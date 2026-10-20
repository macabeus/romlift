// `romlift verify [--rom <rom>] [--assemble] [--link] [--printer raw] [--json]` (architecture §2.1, §6.4, D49): the
// self-checks of the tree romlift emits. Inside a project without --rom (phase 4) it reads the project's ROM and
// romlift.toml (shell/project/read-inputs.ts) and checks what `generate` emits for them (generateProject: another
// ROM than [rom] sha1 records, or a config the model refuses, is an error, exit 1); with --rom, as in phase 3, the
// config is the one configFromDiscover builds from the ROM's discover analysis, and `generate` then runs the confirm
// analysis, builds the model and makes the check pass (tiling, re-encode, module size, text layout, paths).
// --assemble and --link write the tree into a fresh temporary directory, never the working directory
// (writeFreshTree: planWrites with no manifest over an empty disk, then applyWrites), and run `as` per module against its ROM
// range and the full link against the ROM's SHA-1; they run only when the self-checks passed, since a write
// follows a passing check pass (§6.4). Output (frozen by the g3.self-check, g3.text-layout, g3.link and
// g3.raw-link headers): with --json, one {"type":"check","id","status":"ok"|"fail","detail"} line per check in
// CHECK_IDS order, the {"type":"diagnostic"} lines, then {"type":"summary","ok","exitCode","sha1"?,"counts"};
// text mode prints the same as lines, the diagnostics on stderr. Exit codes: 0 every check passed, 3 a check
// failed (a self-check, an object that differs, a linked SHA-1 that differs), 1 an error diagnostic of the input
// or the toolchain (an unreadable file, E_ROM_NOT_GBA, a model error, binutils missing), 2 usage.
import { assembleUnits, buildUnits } from '../../api/model.ts';
import { assembleCheck, linkCheck, writeFreshTree } from '../../api/project.ts';
import { readRom } from '../../api/files.ts';
import type { Diagnostic, Rom } from '../../api/rom.ts';
import { findBinutils } from '../../api/toolchain.ts';
import type { Printer } from '../../api/emit.ts';
import { combineReports, VerifyCodes } from '../../api/verify.ts';
import type { CheckId, CheckResult, VerifyReport } from '../../api/verify.ts';
import { generatedEntries, generateProject, writable } from '../../core/workflow/generate.ts';
import { generateFromRom } from '../../core/workflow/init-config.ts';
import { readProject, resolveFrom } from '../../shell/project/read-inputs.ts';
import type { GenerateResult } from '../../core/workflow/generate.ts';
import { withTempDir } from '../../shell/temp-dir.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { exitCodeOf, printDiagnosticsOnly, usageError } from './analysis-records.ts';

const PRINTERS: readonly Printer[] = ['readable', 'raw'];
const VERIFY_CODES: ReadonlySet<string> = new Set(Object.keys(VerifyCodes));
/** Where the tree of --assemble and --link is written: under os.tmpdir(), never the working directory. */
export const VERIFY_TEMP_PREFIX = 'romlift-verify-';

/** What the toolchain part of a run adds: its checks and the linked image's SHA-1. */
interface ToolchainOutcome {
  readonly checks: readonly CheckResult[];
  readonly sha1?: string;
}

/** The outcome of one verify run, before it is printed. */
export interface VerifyOutcome {
  readonly report: VerifyReport;
  /** The analysis and model diagnostics; each check's own are in `report`. */
  readonly diagnostics: readonly Diagnostic[];
  readonly files: number;
  readonly sha1?: string;
}

function notRun(id: CheckId, detail: string, diagnostics: readonly Diagnostic[] = []): CheckResult {
  return { id, ok: false, detail, diagnostics };
}

/** Every diagnostic of an outcome: the analysis and model ones, then each check's, in report order. */
function allDiagnostics(outcome: Pick<VerifyOutcome, 'report' | 'diagnostics'>): readonly Diagnostic[] {
  return [...outcome.diagnostics, ...outcome.report.checks.flatMap((c) => c.diagnostics)];
}

/**
 * 1 when an error diagnostic is not a self-check's (the input, the model or the toolchain is wrong), else 3 when
 * a check failed, else 0 (architecture §2.1, D33).
 */
export function verifyExitCode(outcome: Pick<VerifyOutcome, 'report' | 'diagnostics'>): ExitCode {
  if (allDiagnostics(outcome).some((d) => d.severity === 'error' && !VERIFY_CODES.has(d.code))) return ExitCode.errors;
  return outcome.report.ok ? ExitCode.ok : ExitCode.verifyFailed;
}

/**
 * The exit code of a refusal that planned nothing: 1 when an error diagnostic is not a self-check's (the input or the
 * model is wrong), else 3 (a self-check failed; also when nothing says why, since only a check refuses silently).
 */
export function refusedExitCode(diagnostics: readonly Diagnostic[]): ExitCode {
  return diagnostics.some((d) => d.severity === 'error' && !VERIFY_CODES.has(d.code)) ? ExitCode.errors : ExitCode.verifyFailed;
}

/** The toolchain checks a run asks for, in CHECK_IDS order. */
type ToolchainFlags = { readonly assemble: boolean; readonly link: boolean };

function toolchainIds(flags: ToolchainFlags): readonly CheckId[] {
  return [...(flags.assemble ? (['assemble'] as const) : []), ...(flags.link ? (['link'] as const) : [])];
}

/** Writes the tree into `dir` and runs the requested toolchain checks there. */
async function checkInDir(dir: string, rom: Rom, result: GenerateResult, flags: ToolchainFlags, ids: readonly CheckId[], io: CliIo): Promise<ToolchainOutcome> {
  const { model } = result;
  const applied = await writeFreshTree(dir, { model, entries: generatedEntries(rom, result), paths: result.paths });
  if (!applied.ok) return { checks: ids.map((id) => notRun(id, 'the tree could not be written', applied.diagnostics)) };
  const tools = findBinutils(io.env);
  if ('code' in tools) return { checks: ids.map((id) => notRun(id, 'binutils not found', [tools])) };
  const checks: CheckResult[] = [];
  if (flags.assemble) checks.push(await assembleCheck({ dir, rom, units: assembleUnits(model), tools }));
  if (!flags.link) return { checks };
  const linked = await linkCheck({ dir, rom, units: buildUnits(model), tools });
  checks.push(linked);
  return linked.sha1 === null ? { checks } : { checks, sha1: linked.sha1 };
}

/** The toolchain checks of a run, in a temporary directory; not run when the self-checks or the model failed. */
export async function toolchainChecks(rom: Rom, result: GenerateResult, flags: ToolchainFlags, io: CliIo): Promise<ToolchainOutcome> {
  const ids = toolchainIds(flags);
  if (ids.length === 0) return { checks: [] };
  if (!writable(result)) {
    return { checks: ids.map((id) => notRun(id, 'not run: nothing is written while a self-check or the model fails')) };
  }
  const ran = await withTempDir(VERIFY_TEMP_PREFIX, (dir) => checkInDir(dir, rom, result, flags, ids, io));
  return ran.ok ? ran.value : { checks: ids.map((id) => notRun(id, 'no temporary directory', [ran.diagnostic])) };
}

/** Verifies a ROM: generateFromRom (discover, configFromDiscover, generate), then the toolchain checks asked for. */
async function verifyRom(rom: Rom, options: { readonly printer: Printer } & ToolchainFlags, io: CliIo): Promise<VerifyOutcome | { readonly refused: readonly Diagnostic[] }> {
  const result = generateFromRom(rom, { decomp: { defined: [] }, printer: options.printer });
  if (!result.ok) return { refused: result.diagnostics };
  const toolchain = await toolchainChecks(rom, result, options, io);
  const report = combineReports(result.report, { ok: toolchain.checks.every((c) => c.ok), checks: toolchain.checks });
  return { report, diagnostics: result.diagnostics, files: result.paths.length, ...(toolchain.sha1 === undefined ? {} : { sha1: toolchain.sha1 }) };
}

/** Verifies the project that holds `from`: generateProject over its ROM and config, then the toolchain checks asked for. */
async function verifyProject(from: string, options: { readonly printer: Printer } & ToolchainFlags, io: CliIo): Promise<VerifyOutcome | { readonly refused: readonly Diagnostic[] }> {
  const read = await readProject(from);
  if (!read.ok) return { refused: read.diagnostics };
  const rom = read.value.inputs.rom;
  const generated = generateProject(read.value.inputs, { printer: options.printer });
  if (!generated.ok) return { refused: generated.diagnostics };
  const result = generated.result;
  const toolchain = await toolchainChecks(rom, result, options, io);
  const report = combineReports(result.report, { ok: toolchain.checks.every((c) => c.ok), checks: toolchain.checks });
  return { report, diagnostics: result.diagnostics, files: result.paths.length, ...(toolchain.sha1 === undefined ? {} : { sha1: toolchain.sha1 }) };
}

/** The summary of a run: its exit code, the counts, and the linked SHA-1 when there is one. */
function verifySummary(outcome: VerifyOutcome, exitCode: ExitCode): RunSummary & { readonly sha1?: string } {
  return {
    ok: exitCode === ExitCode.ok,
    exitCode,
    counts: { checks: outcome.report.checks.length, failed: outcome.report.checks.filter((c) => !c.ok).length, files: outcome.files, diagnostics: allDiagnostics(outcome).length },
    ...(outcome.sha1 === undefined ? {} : { sha1: outcome.sha1 }),
  };
}

/** The --json output: one check line per check, the diagnostics, then the summary. */
export function verifyNdjson(outcome: VerifyOutcome, summary: RunSummary & { readonly sha1?: string }): string {
  return [
    ...outcome.report.checks.map((c) => recordLine('check', { id: c.id, status: c.ok ? 'ok' : 'fail', detail: c.detail })),
    ...allDiagnostics(outcome).map(diagnosticLine),
    recordLine('summary', { ok: summary.ok, exitCode: summary.exitCode, sha1: summary.sha1, counts: summary.counts }),
  ].join('');
}

/** The text output: one line per check and the summary on stdout, the diagnostics on stderr. */
export function verifyText(outcome: VerifyOutcome, summary: RunSummary & { readonly sha1?: string }): { readonly stdout: string; readonly stderr: string } {
  const width = Math.max(0, ...outcome.report.checks.map((c) => c.id.length));
  let stdout = outcome.report.checks.map((c) => `${c.id.padEnd(width)}  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.detail}\n`).join('');
  if (summary.sha1 !== undefined) stdout += `linked SHA-1 ${summary.sha1}\n`;
  stdout += `verify: ${formatSummaryText(summary)}\n`;
  return { stdout, stderr: allDiagnostics(outcome).map((d) => `${formatDiagnosticText(d)}\n`).join('') };
}

function isPrinter(text: string): text is Printer {
  return (PRINTERS as readonly string[]).includes(text);
}

export const verifyCommand: CommandSpec = {
  name: 'verify',
  summary: 'Self-checks the tree romlift emits for a ROM: tiling, re-encode, module size, text layout, paths; with --assemble and --link, the toolchain',
  usage: 'verify [--rom <rom>] [--assemble] [--link] [--printer readable|raw] [--json]',
  positionals: [],
  options: [
    { name: 'rom', kind: 'string', summary: "A bare ROM to verify, with the config built from its discover analysis; default the project's ROM and romlift.toml", value: '<rom>' },
    { name: 'assemble', kind: 'boolean', summary: "Assembles each module in a temporary directory and compares its object with the module's ROM range" },
    { name: 'link', kind: 'boolean', summary: "Links the whole tree in a temporary directory and compares the image's SHA-1 with the ROM's" },
    { name: 'printer', kind: 'string', summary: "The printer: 'readable' (default) or 'raw' (every chunk as data)", value: '<printer>' },
    { name: 'json', kind: 'boolean', summary: 'Prints NDJSON: one line per check, the diagnostics, then a summary' },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const path = args.options['rom'];
    const printer = args.options['printer'] ?? 'readable';
    if (!isPrinter(printer)) return usageError(io, 'verify', `--printer is 'readable' or 'raw', not '${printer}'`);
    const options = { printer, assemble: args.flags['assemble'] === true, link: args.flags['link'] === true };
    let outcome: VerifyOutcome | { readonly refused: readonly Diagnostic[] };
    if (path === undefined) {
      outcome = await verifyProject(io.cwd, options, io);
    } else {
      const loaded = await readRom(resolveFrom(io.cwd, path));
      if (!loaded.ok) {
        printDiagnosticsOnly(io, json, 'verify', [loaded.diagnostic], { ok: false, exitCode: ExitCode.errors });
        return ExitCode.errors;
      }
      outcome = await verifyRom(loaded.value, options, io);
    }
    if ('refused' in outcome) {
      const exitCode = exitCodeOf(outcome.refused) === ExitCode.ok ? ExitCode.ok : refusedExitCode(outcome.refused);
      printDiagnosticsOnly(io, json, 'verify', outcome.refused, { ok: exitCode === ExitCode.ok, exitCode });
      return exitCode;
    }
    const exitCode = verifyExitCode(outcome);
    const summary = verifySummary(outcome, exitCode);
    if (json) {
      io.stdout(verifyNdjson(outcome, summary));
    } else {
      const text = verifyText(outcome, summary);
      if (text.stderr !== '') io.stderr(text.stderr);
      io.stdout(text.stdout);
    }
    return exitCode;
  },
};
