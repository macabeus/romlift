// `romlift generate [--rom <rom>] [--dry-run] [--json] [--out <dir>]` (architecture §2.1, §6.4, D17, D49): the tree of
// the project that holds the working directory, from its decomp.yaml, its romlift.toml, its ROM and its src/*.c, whose
// INCLUDE_ASM lines it reconciles with the model (D75 b). The
// shell reads the project (shell/project/read-inputs.ts), generateProject plans and checks the emission, then, holding
// the project lock, the disk is snapshotted, planWrites decides every op and applyWrites applies them; a plan that
// changes nothing is not applied at all, so every file keeps its modification time (g4.generate-idempotent). It never
// writes romlift.toml (g4.no-toml-write). --rom reads another ROM file than the config's [rom] path (a worktree
// without one), which must still have the recorded SHA-1; --dry-run prints the ops instead of applying them
// (`{"type":"op","op","path"}` lines with --json); --out plans and applies against another directory, which is how
// the bench compares trees without touching the project. Exit codes: 0 ok, 1 an error diagnostic (the project
// cannot be read, another ROM, an illegal config such as E_MODULE_BORDER, E_DUPLICATE_ADDRESS or
// E_TOML_KEY_SPELLING, a refused write, a locked project), 3 a failed self-check (nothing written), 2 usage.
import type { Diagnostic } from '../../api/rom.ts';
import type { WriteOp } from '../../api/write-plan.ts';
import { generateProject, writable } from '../../core/workflow/generate.ts';
import { packageVersion, readProject, resolveFrom } from '../../shell/project/read-inputs.ts';
import { writeTree } from '../../shell/project/write-project.ts';
import { ExitCode } from '../exit-codes.ts';
import type { RunSummary } from '../exit-codes.ts';
import type { CliIo, CommandSpec } from '../registry.ts';
import { diagnosticLine, recordLine, summaryLine } from '../reporters/ndjson.ts';
import { formatDiagnosticText, formatSummaryText } from '../reporters/text.ts';
import { opCounts, printDiagnosticsOnly, refusedExitCode, verifyExitCode, writeLines } from './command-common.ts';

/** The `{"type":"op","op","path"}` line of one op (g4.generate-idempotent). */
export function opLine(op: WriteOp): string {
  return recordLine('op', { op: op.op, path: op.path });
}

/** The text line of an op that changes a file; a keep prints nothing. */
function opText(op: WriteOp): string {
  return op.op === 'keep' ? '' : `${op.op.padEnd(6)} ${op.path}\n`;
}

/** The exit code of a write: 1 when it raised an error, else 0. */
function writeExitCode(diagnostics: readonly Diagnostic[]): ExitCode {
  return diagnostics.some((d) => d.severity === 'error') ? ExitCode.errors : ExitCode.ok;
}

/** Prints a run's outcome: the op lines (all with --json and --dry-run, the changing ones in text), the diagnostics, the summary. */
async function printOutcome(
  io: CliIo,
  json: boolean,
  dryRun: boolean,
  ops: readonly WriteOp[],
  diagnostics: readonly Diagnostic[],
  summary: RunSummary,
): Promise<void> {
  if (json) {
    await writeLines(io, [
      ...(dryRun ? ops.map(opLine) : []),
      ...diagnostics.map(diagnosticLine),
      summaryLine(summary),
    ]);
    return;
  }
  if (diagnostics.length > 0) io.stderr(diagnostics.map((d) => `${formatDiagnosticText(d)}\n`).join(''));
  await writeLines(io, [...ops.map(opText), `generate${dryRun ? ' --dry-run' : ''}: ${formatSummaryText(summary)}\n`]);
}

export const generateCommand: CommandSpec = {
  name: 'generate',
  summary:
    "Regenerates the project's tree (asm/, data/, expected/, ldscript.txt, symbols.ld, objdiff.json, modules.mk) from its ROM and romlift.toml, and the INCLUDE_ASM lines of src/*.c (missing files written); never writes the TOML",
  usage: 'generate [--rom <rom>] [--dry-run] [--json] [--out <dir>]',
  positionals: [],
  options: [
    {
      name: 'rom',
      kind: 'string',
      summary: "Reads this ROM instead of the config's [rom] path (it must have the recorded SHA-1)",
      value: '<rom>',
    },
    { name: 'dry-run', kind: 'boolean', summary: 'Prints the write plan instead of applying it' },
    {
      name: 'json',
      kind: 'boolean',
      summary: 'Prints NDJSON: the ops (with --dry-run), the diagnostics, then a summary',
    },
    {
      name: 'out',
      kind: 'string',
      summary: 'Writes the tree into this directory instead of the project',
      value: '<dir>',
    },
  ],
  async run(args, io) {
    const json = args.flags['json'] === true;
    const dryRun = args.flags['dry-run'] === true;
    const romOption = args.options['rom'];
    const read = await readProject(io.cwd, romOption === undefined ? {} : { rom: romOption });
    if (!read.ok) {
      printDiagnosticsOnly(io, json, 'generate', read.diagnostics, { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const project = read.value;
    const generated = generateProject(project.inputs);
    if (!generated.ok) {
      const exitCode = refusedExitCode(generated.diagnostics);
      printDiagnosticsOnly(io, json, 'generate', generated.diagnostics, { ok: false, exitCode });
      return exitCode;
    }
    const { result } = generated;
    const checked = [...result.diagnostics, ...result.report.checks.flatMap((c) => c.diagnostics)];
    if (!writable(result)) {
      const exitCode = verifyExitCode({ report: result.report, diagnostics: result.diagnostics });
      printDiagnosticsOnly(io, json, 'generate', checked, {
        ok: false,
        exitCode,
        counts: { files: result.paths.length },
      });
      return exitCode;
    }
    const version = await packageVersion();
    if (!version.ok) {
      printDiagnosticsOnly(io, json, 'generate', [version.diagnostic], { ok: false, exitCode: ExitCode.errors });
      return ExitCode.errors;
    }
    const out = args.options['out'];
    const dir = out === undefined ? project.dir : resolveFrom(io.cwd, out);
    const written = await writeTree(
      dir,
      { result, rom: project.inputs.rom, target: dir === project.dir ? 'project' : 'out' },
      version.value,
      dryRun,
    );
    const ops: readonly WriteOp[] = written.ok ? written.value.plan.ops : [];
    const diagnostics: readonly Diagnostic[] = [
      ...project.notes,
      ...checked,
      ...(written.ok ? written.value.diagnostics : written.diagnostics),
    ];
    const exitCode = writeExitCode(diagnostics);
    const summary: RunSummary = {
      ok: exitCode === ExitCode.ok,
      exitCode,
      counts: { ...opCounts(ops), files: result.paths.length },
    };
    await printOutcome(io, json, dryRun, ops, diagnostics, summary);
    return exitCode;
  },
};
