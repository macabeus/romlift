// `romlift verify [--rom <rom>] [--assemble] [--link] [--printer raw] [--json]` (architecture §2.1, §6.4, D49): the
// self-checks of the tree romlift emits. Inside a project without --rom (phase 4) it reads the project's ROM and
// romlift.toml (shell/project/read-inputs.ts) and checks what `generate` emits for them (generateProject: another
// ROM than [rom] sha1 records, or a config the model refuses, is an error, exit 1); with --rom, as in phase 3, the
// config is the one configFromDiscover builds from the ROM's discover analysis, and `generate` then runs the confirm
// analysis, builds the model and makes the check pass (tiling, re-encode, module size, text layout, paths).
// --assemble and --link write the tree into a fresh temporary directory, never the working directory, and run `as`
// per module against its ROM range and the full link against the ROM's SHA-1; they run only when the self-checks
// passed, since a write follows a passing check pass (§6.4). The composition is core/workflow/verify.ts's
// (toolchainPlan, verifyReport) and the shell's runner (shell/project/verify-run.ts); this file only parses and prints. Output (frozen by the g3.self-check, g3.text-layout, g3.link and
// g3.raw-link headers): with --json, one {"type":"check","id","status":"ok"|"fail","detail"} line per check in
// CHECK_IDS order, the {"type":"diagnostic"} lines, then {"type":"summary","ok","exitCode","sha1"?,"counts"};
// text mode prints the same as lines, the diagnostics on stderr. Exit codes: 0 every check passed, 3 a check
// failed (a self-check, an object that differs, a linked SHA-1 that differs), 1 an error diagnostic of the input
// or the toolchain (an unreadable file, E_ROM_NOT_GBA, a model error, binutils missing), 2 usage.
import { readRom } from '../../api/files.ts';
import type { Diagnostic, Rom } from '../../api/rom.ts';
import type { Printer } from '../../api/emit.ts';
import type { VerifyReport } from '../../api/verify.ts';
import { generateProject } from '../../core/workflow/generate.ts';
import type { GenerateResult } from '../../core/workflow/generate.ts';
import { generateFromRom } from '../../core/workflow/init-config.ts';
import { verifyReport } from '../../core/workflow/verify.ts';
import type { ToolchainFlags } from '../../core/workflow/verify.ts';
import { readProject, resolveFrom } from '../../shell/project/read-inputs.ts';
import { projectConfigIgnored } from '../../shell/project/locate.ts';
import { runToolchainChecks } from '../../shell/project/verify-run.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { allDiagnostics, exitCodeOf, printDiagnosticsOnly, refusedExitCode, usageError, verifyExitCode } from './command-common.ts';

const PRINTERS: readonly Printer[] = ['readable', 'raw'];

/** The outcome of one verify run, before it is printed. */
export interface VerifyOutcome {
  readonly report: VerifyReport;
  /** The analysis and model diagnostics; each check's own are in `report`. */
  readonly diagnostics: readonly Diagnostic[];
  readonly files: number;
  readonly sha1?: string;
}

type Refused = { readonly refused: readonly Diagnostic[] };

/** The outcome of a generate result and the toolchain checks asked for (core/workflow/verify.ts, shell/project/verify-run.ts). */
async function verifyResult(rom: Rom, result: GenerateResult, flags: ToolchainFlags, io: CliIo): Promise<VerifyOutcome> {
  const toolchain = await runToolchainChecks(rom, result, flags, io.env);
  return { report: verifyReport(result, toolchain), diagnostics: result.diagnostics, files: result.paths.length, ...(toolchain.sha1 === undefined ? {} : { sha1: toolchain.sha1 }) };
}

/** Verifies a ROM: generateFromRom (discover, configFromDiscover, generate), then the toolchain checks asked for. */
async function verifyRom(rom: Rom, options: { readonly printer: Printer } & ToolchainFlags, io: CliIo): Promise<VerifyOutcome | Refused> {
  const result = generateFromRom(rom, { decomp: { defined: [] }, printer: options.printer });
  return result.ok ? verifyResult(rom, result, options, io) : { refused: result.diagnostics };
}

/** Verifies the project that holds `from`: generateProject over its ROM and config, then the toolchain checks asked for. */
async function verifyProject(from: string, options: { readonly printer: Printer } & ToolchainFlags, io: CliIo): Promise<VerifyOutcome | Refused> {
  const read = await readProject(from);
  if (!read.ok) return { refused: read.diagnostics };
  const generated = generateProject(read.value.inputs, { printer: options.printer });
  return generated.ok ? verifyResult(read.value.inputs.rom, generated.result, options, io) : { refused: generated.diagnostics };
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
    let outcome: VerifyOutcome | Refused;
    if (path === undefined) {
      outcome = await verifyProject(io.cwd, options, io);
    } else {
      const loaded = await readRom(resolveFrom(io.cwd, path));
      if (!loaded.ok) {
        printDiagnosticsOnly(io, json, 'verify', [loaded.diagnostic], { ok: false, exitCode: ExitCode.errors });
        return ExitCode.errors;
      }
      const ran = await verifyRom(loaded.value, options, io);
      const ignored = await projectConfigIgnored(io.cwd, 'verify');
      outcome = 'refused' in ran || ignored === undefined ? ran : { ...ran, diagnostics: [ignored, ...ran.diagnostics] };
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
